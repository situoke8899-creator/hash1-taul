import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const HX_HISTORY_URL = 'https://hx168.live/api/Game/GetLong?gameId=1'
const MAX_ITEMS = 220

function isDigit(ch) {
  return ch >= '0' && ch <= '9'
}

// 规则：从哈希最后往前找两位连续数字，把两位反过来，反转后的数字在 00-35 内即为开奖结果。
export function parseHashOpenNumber(hash) {
  const text = String(hash || '').toLowerCase()

  for (let i = text.length - 1; i >= 1; i--) {
    const left = text[i - 1]
    const right = text[i]

    if (isDigit(left) && isDigit(right)) {
      const sourcePair = `${left}${right}`
      const openCode = `${right}${left}`
      const value = Number(openCode)

      if (Number.isInteger(value) && value >= 0 && value < 36) {
        return {
          openCode: openCode.padStart(2, '0'),
          value,
          tail: value % 10,
          sourcePair,
        }
      }
    }
  }

  return null
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      accept: 'application/json,text/plain,*/*',
      'user-agent': 'Mozilla/5.0',
      ...(options.headers || {}),
    },
    ...options,
  })

  const text = await res.text()
  if (!res.ok) throw new Error(`接口请求失败：${url}`)
  if (!text.trim()) throw new Error(`接口返回空内容：${url}`)
  if (text.trim().startsWith('<')) throw new Error(`接口返回网页，不是 JSON：${url}`)
  return JSON.parse(text)
}

async function fetchTronBlockHash(blockNumber) {
  const num = Number(blockNumber)
  if (!Number.isInteger(num) || num <= 0) return ''

  // TronGrid 钱包接口：返回 blockID 作为区块哈希。失败时会自动回退到平台已给结果。
  try {
    const json = await fetchJson('https://api.trongrid.io/wallet/getblockbynum', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ num }),
    })

    return String(json?.blockID || json?.blockId || json?.hash || '')
  } catch (error) {
    console.log(`获取区块哈希失败 ${num}:`, error.message)
    return ''
  }
}

function normalizeHxRows(json) {
  const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : []

  return rows
    .map((item, index) => ({
      index,
      block: Number(item.block || item.blockNumber || item.height || 0),
      hash: String(item.hash || item.blockHash || item.hashCode || item.block_hash || ''),
      platformNum: Number(item.num ?? item.openCode ?? item.result ?? NaN),
      wei: Number(item.wei ?? 0),
      playType: Number(item.playType ?? 0),
      raw: item,
    }))
    .filter((item) => Number.isInteger(item.block) && item.block > 0)
    .slice(0, MAX_ITEMS)
}

async function enrichRowsWithHash(rows) {
  const cache = new Map()
  const result = []

  for (const row of rows) {
    let hash = row.hash

    if (!hash) {
      if (!cache.has(row.block)) {
        cache.set(row.block, await fetchTronBlockHash(row.block))
      }
      hash = cache.get(row.block) || ''
    }

    const parsed = hash ? parseHashOpenNumber(hash) : null
    const fallbackValue = Number.isInteger(row.platformNum) ? row.platformNum : null
    const value = parsed?.value ?? fallbackValue

    result.push({
      block: row.block,
      hash,
      sourcePair: parsed?.sourcePair || '',
      openCode: parsed?.openCode || (value !== null ? String(value).padStart(2, '0') : ''),
      value,
      tail: value !== null ? Math.abs(value) % 10 : null,
      platformNum: Number.isInteger(row.platformNum) ? row.platformNum : null,
      wei: row.wei,
      playType: row.playType,
      parsedByHash: Boolean(parsed),
    })
  }

  return result.filter((item) => item.value !== null && item.tail !== null)
}

export async function GET() {
  try {
    const json = await fetchJson(HX_HISTORY_URL)
    const rows = normalizeHxRows(json)
    const history = await enrichRowsWithHash(rows)

    if (!history.length) {
      throw new Error('没有获取到哈希1分轮盘开奖记录')
    }

    const latest = history[0]
    const nextBlock = Number(latest.block || 0) + 20

    return NextResponse.json({
      ok: true,
      play: 'hash1-wheel',
      source: HX_HISTORY_URL,
      latest,
      nextBlock,
      history,
      updatedAt: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error.message || '获取哈希1分轮盘数据失败' },
      { status: 500 }
    )
  }
}
