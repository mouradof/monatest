import { Token } from '@monadex/sdk'
import { Tags, TokenInfo } from '@uniswap/token-lists'
import { TokenList } from '@uniswap/token-lists/dist/types'
import { isAddress } from 'viem'

type TagDetails = Tags[keyof Tags]

interface TagInfo extends TagDetails {
  id: string
}

/**
 * Token instances created from token info on a token list.
 */
export class WrappedTokenInfo implements Token {
  public readonly isNative = false
  public readonly isToken = true
  public readonly list: TokenList | undefined

  public readonly tokenInfo: TokenInfo
  private _checksummedAddress: string | null = null

  constructor (tokenInfo: TokenInfo, list?: TokenList) {
    this.tokenInfo = tokenInfo
    this.list = list
  }

  public get address (): string {
    if (this._checksummedAddress !== null) return this._checksummedAddress
    const checksummedAddress = isAddress(this.tokenInfo.address)
    if (!checksummedAddress) { throw new Error(`Invalid token address: ${this.tokenInfo.address}`) }
    this._checksummedAddress = this.tokenInfo.address
    return this._checksummedAddress
  }

  public get chainId (): number {
    return this.tokenInfo.chainId
  }

  public get decimals (): number {
    return this.tokenInfo.decimals
  }

  public get name (): string {
    return this.tokenInfo.name
  }

  public get symbol (): string {
    return this.tokenInfo.symbol
  }

  public get logoURI (): string | undefined {
    return this.tokenInfo.logoURI
  }

  private _tags: TagInfo[] | null = null
  public get tags (): TagInfo[] {
    if (this._tags !== null) return this._tags
    if (this.tokenInfo.tags == null) return (this._tags = [])
    const listTags = this.list?.tags
    if (listTags == null) return (this._tags = [])

    return (this._tags = this.tokenInfo.tags.map((tagId) => {
      return {
        ...listTags[tagId],
        id: tagId
      }
    }))
  }

  public get wrapped (): Token {
    return this
  }

  equals (other: Token): boolean {
    return (
      other.chainId === this.chainId &&
      this.address !== null &&
      other.address !== null &&
      other.address.toLowerCase() === this.address.toLowerCase()
    )
  }

  sortsBefore (other: Token): boolean {
    if (this.equals(other)) throw new Error('Addresses should not be equal')
    return this.address.toLowerCase() < other.address.toLowerCase()
  }
}
