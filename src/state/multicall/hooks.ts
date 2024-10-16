import { FunctionFragment, Interface } from '@ethersproject/abi'
import { BigNumber } from '@ethersproject/bignumber'
import { Contract } from '@ethersproject/contracts'
import { useEffect, useMemo } from 'react'
import { useDispatch, useSelector } from 'react-redux'

import {
  addMulticallListeners,
  Call,
  ListenerOptions,
  parseCallKey,
  removeMulticallListeners,
  toCallKey
} from './actions'

import { useBlockNumber } from '../application/hooks'
import { AppDispatch, AppState } from '../store'
import { useWalletData } from '@/utils'
export interface Result extends ReadonlyArray<any> {
  readonly [key: string]: any
}

type MethodArg = string | number | BigNumber
type MethodArgs = Array<MethodArg | MethodArg[]>
type OptionalMethodInputs = Array<MethodArg | MethodArg[] | undefined> | undefined

function isMethodArg (inputs: unknown): inputs is MethodArg {
  return ['string', 'number'].includes(typeof inputs)
}

function isValidMethodArgs (inputs?: OptionalMethodInputs): inputs is MethodArgs | undefined {
  return (
    inputs === undefined ||
      (Array.isArray(inputs) && inputs.every((xi) => isMethodArg(xi) || (Array.isArray(xi) && xi.every(isMethodArg))))
  )
}

interface CallResult {
  readonly valid: boolean
  readonly data: string | undefined
  readonly blockNumber: number | undefined
}
const INVALID_RESULT: CallResult = { valid: false, blockNumber: undefined, data: undefined }

// use this options object
export const NEVER_RELOAD: ListenerOptions = {
  blocksPerFetch: Infinity
}

// the lowest level call for subscribing to contract data
function useCallsData (calls: Array<Call | undefined>, options?: ListenerOptions, ignore?: boolean): CallResult[] {
  const { chainId } = useWalletData()
  const callResults = useSelector<
  AppState,
  AppState['multicall']['callResults']>(
    (state) => state.multicall.callResults
  )

  const dispatch = useDispatch<AppDispatch>()
  const serializedCallKeys: string = useMemo(
    () =>
      JSON.stringify(
        calls
          ?.filter((c): c is Call => Boolean(c))
          ?.map(toCallKey)
          ?.sort() ?? []
      ),
    [calls]
  )
  // update listeners when there is an actual change that persists for at least 100ms
  useEffect(() => {
    const callKeys: string[] = JSON.parse(serializedCallKeys)

    if (chainId === undefined || callKeys.length === 0) return undefined
    const calls = callKeys.map((key) => parseCallKey(key))

    if (!ignore) {
      dispatch(
        addMulticallListeners({
          chainId,
          calls,
          options
        })
      )

      return () => {
        dispatch(
          removeMulticallListeners({
            chainId,
            calls,
            options
          })
        )
      }
    }
  }, [chainId, dispatch, options, serializedCallKeys])

  return useMemo(
    () =>
      calls?.map<CallResult>((call) => {
        if (chainId === undefined || call === undefined) return INVALID_RESULT
        const result = callResults[chainId]?.[toCallKey(call)]
        let data
        if (result?.data != null && result?.data !== '0x') {
          data = result.data
        }
        return { valid: true, data, blockNumber: result?.blockNumber }
      }),
    [callResults, calls, chainId]
  )
}

interface CallState {
  readonly valid: boolean
  // the result, or undefined if loading or errored/no data
  readonly result: Result | undefined
  // true if the result has never been fetched
  readonly loading: boolean
  // true if the result is not for the latest block
  readonly syncing: boolean
  // true if the call was made and is synced, but the return data is invalid
  readonly error: boolean
}

const INVALID_CALL_STATE: CallState = { valid: false, result: undefined, loading: false, syncing: false, error: false }
const LOADING_CALL_STATE: CallState = { valid: true, result: undefined, loading: true, syncing: true, error: false }

function toCallState (
  callResult: CallResult | undefined,
  contractInterface: Interface | undefined,
  fragment: FunctionFragment | undefined,
  latestBlockNumber: number | undefined,
  ignore?: boolean
): CallState {
  if (ignore) return INVALID_CALL_STATE
  if (callResult == null) return INVALID_CALL_STATE

  const { valid, data, blockNumber } = callResult
  if (!valid) return INVALID_CALL_STATE
  if (valid && !blockNumber) return LOADING_CALL_STATE
  if ((contractInterface == null) || (fragment == null) || !latestBlockNumber) { return LOADING_CALL_STATE }
  const success = data && data.length > 2
  const syncing = (blockNumber ?? 0) < latestBlockNumber
  let result: Result | undefined
  if (success && data) {
    try {
      result = contractInterface.decodeFunctionResult(fragment, data)
    } catch (error) {
      console.debug('Result data parsing failed', fragment, data)
      return {
        valid: true,
        loading: false,
        error: true,
        syncing,
        result
      }
    }
  }
  return {
    valid: true,
    loading: false,
    syncing,
    result,
    error: !success
  }
}

export function useSingleContractMultipleData<T extends Contract = Contract> (
  contract: T | null | undefined,
  methodName: keyof T['estimateGas'] & string,
  callInputs: OptionalMethodInputs[],
  options?: ListenerOptions
): readonly CallState[] {
  const fragment = useMemo(() => contract?.interface?.getFunction(methodName), [contract, methodName])
  const calls = useMemo(
    () =>
      (contract != null) && (fragment != null) && (callInputs != null) && callInputs.length > 0
        ? callInputs.map<Call>((inputs) => {
          return {
            address: contract.address,
            callData: contract.interface.encodeFunctionData(fragment, inputs)
          }
        })
        : [],
    [callInputs, contract, fragment]
  )

  const results = useCallsData(calls, options)

  const latestBlockNumber = useBlockNumber()

  return useMemo(() => {
    return results.map((result) => toCallState(result, contract?.interface, fragment, latestBlockNumber))
  }, [fragment, contract, results, latestBlockNumber])
}

export function useMultipleContractSingleData (
  addresses: Array<string | undefined>,
  contractInterface: Interface,
  methodName: string,
  callInputs?: OptionalMethodInputs,
  options?: ListenerOptions
): CallState[] {
  const fragment = useMemo(() => contractInterface.getFunction(methodName), [contractInterface, methodName])
  const callData: string | undefined = useMemo(
    () =>
      fragment && isValidMethodArgs(callInputs)
        ? contractInterface.encodeFunctionData(fragment, callInputs)
        : undefined,
    [callInputs, contractInterface, fragment]
  )
  const calls = useMemo(
    () =>
      fragment && addresses && addresses.length > 0 && callData
        ? addresses.map<Call | undefined>((address) => {
          return address && callData
            ? {
                address,
                callData
              }
            : undefined
        })
        : [],
    [addresses, callData, fragment]
  )

  const results = useCallsData(calls, options)
  const latestBlockNumber = useBlockNumber()
  const value = useMemo(() => {
    return results.map((result) => toCallState(result, contractInterface, fragment, latestBlockNumber))
  }, [fragment, results, contractInterface, latestBlockNumber])
  return value
}

export function useSingleCallResult (
  contract: Contract | null | undefined,
  methodName: string,
  inputs?: OptionalMethodInputs,
  options?: ListenerOptions,
  ignore?: boolean
): CallState {
  const fragment = useMemo(() => contract?.interface?.getFunction(methodName), [
    contract,
    methodName
  ])
  const calls = useMemo<Call[]>(() => {
    return (contract != null) && (fragment != null) && isValidMethodArgs(inputs)
      ? [
          {
            address: contract.address,
            callData: contract.interface.encodeFunctionData(fragment, inputs)
          }
        ]
      : []
  }, [contract, fragment, inputs])
  const result = useCallsData(calls, options, ignore)[0]
  const latestBlockNumber = useBlockNumber()

  return useMemo(() => {
    return toCallState(
      result,
      contract?.interface,
      fragment,
      latestBlockNumber
    )
  }, [result, contract, fragment, latestBlockNumber])
}
