import { isValidAddress, normalizeBitcoinAddress } from '@/lib/formValidation'
import { satsToBtc, tryBtcToSat } from '@/lib/utils'
import type { AmountSats, BitcoinAddress } from '@/types/global'

const BITCOIN_URI_SCHEME = 'bitcoin:'

export type Bip21ParseResult = {
  address: BitcoinAddress
  amount?: AmountSats
  label?: string
  message?: string
  fromUri: boolean
}

const REQUIRED_PARAMETER_PREFIX = 'req-'

const readParameters = (queryString: string) => {
  const byLowercaseName = new Map<string, string>()
  for (const [name, value] of new URLSearchParams(queryString)) {
    const key = name.toLowerCase()
    if (!byLowercaseName.has(key)) {
      byLowercaseName.set(key, value)
    }
  }
  return byLowercaseName
}

const hasUnsupportedRequiredParameter = (parameters: ReadonlyMap<string, string>) =>
  [...parameters.keys()].some((name) => name.startsWith(REQUIRED_PARAMETER_PREFIX))

// BIP21: `amountparam = "amount=" *digit [ "." *digit ]` - plain decimal BTC, no sign or whitespace.
// A bitcoin amount cannot be more precise than 1 sat, so more than 8 decimal places is invalid
// (and must not be silently truncated to a different amount).
const BIP21_AMOUNT_REGEX = /^(?=\.?\d)\d*(?:\.\d{0,8})?$/

// BIP21 allows amounts without an integer part, e.g. `.5` - prefix them with `0` before conversion.
const normalizeAmount = (value: string) => (value.startsWith('.') ? `0${value}` : value)

const parseAmount = (value: string): AmountSats | undefined =>
  BIP21_AMOUNT_REGEX.test(value) ? tryBtcToSat(normalizeAmount(value)) : undefined

export const parseBip21Uri = (raw: string): Bip21ParseResult | undefined => {
  const trimmed = raw.trim()

  // BIP21: bitcoin:<address>?amount=<btc>&...
  if (!trimmed.toLowerCase().startsWith(BITCOIN_URI_SCHEME)) {
    // raw address (no URI scheme)
    const address = normalizeBitcoinAddress(trimmed)
    if (isValidAddress(address)) {
      return { address, fromUri: false }
    }
    return undefined
  }

  const withoutScheme = trimmed.slice(BITCOIN_URI_SCHEME.length)
  const queryStringIndex = withoutScheme.indexOf('?')
  const addressPart = queryStringIndex === -1 ? withoutScheme : withoutScheme.slice(0, queryStringIndex)
  const queryString = queryStringIndex === -1 ? '' : withoutScheme.slice(queryStringIndex + 1)

  const address = normalizeBitcoinAddress(addressPart)
  if (!isValidAddress(address)) {
    return undefined
  }

  const result: Bip21ParseResult = { address, fromUri: true }

  if (queryString) {
    const parameters = readParameters(queryString)

    if (hasUnsupportedRequiredParameter(parameters)) {
      return undefined
    }

    const amountBtc = parameters.get('amount')
    if (amountBtc !== undefined) {
      const satValue = parseAmount(amountBtc)
      if (satValue !== undefined && satValue > 0) {
        result.amount = satValue
      }
    }
    const label = parameters.get('label')
    if (label) {
      result.label = label
    }
    const message = parameters.get('message')
    if (message) {
      result.message = message
    }
  }

  return result
}

/**
 * Builds a BIP21 payment request URI.
 *
 * The `amount` parameter is only appended for a positive amount, mirroring what
 * the QR code has always encoded. Amounts are rendered with a fixed number of
 * decimals on purpose: `toFixed` keeps small values in plain decimal notation,
 * whereas the default number formatting would switch to scientific notation
 * below 1e-6 BTC (100 sats) and produce a URI that {@link parseBip21Uri} - and
 * other wallets - would reject.
 */
export const toBip21Uri = ({ address, amount }: { address: BitcoinAddress; amount?: AmountSats }): string => {
  const amountBtc = amount !== undefined ? satsToBtc(String(amount)) : 0
  if (!(amountBtc > 0)) {
    return `${BITCOIN_URI_SCHEME}${address}`
  }
  return `${BITCOIN_URI_SCHEME}${address}?amount=${amountBtc.toFixed(8)}`
}
