import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const HX_HISTORY_URL = 'https://hx168.live/api/Game/GetLong?gameId=1'
const MAX_ITEMS = 220

function isDigit(ch) {
  return ch >= '0' && ch <= '9'
}

function parseHashOpenNumber(hash) {
  const text = String(hash || '').toLowerCase()

  for (let i = text.length - 1; i >= 1; i--) {
    const left = text[i - 1]
    const right = text[i]

    if (isDigit(left) && isDigit(right)) {
      const sourcePair = `${left}${right}`
      const openCode = `${right}${left}`
      const value = Number(openCode)

      if (value >= 0 && value < 36) {
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
  const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`, {
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
  const res = await fetch('https://api.trongrid.io/wallet/getblockbynum', {
    method: 'POST',
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0',
    },
    body: JSON.stringify({ num: Number(blockNumber) }),
  })

  const text = await res.text()
  if (!res.ok || !text.trim()) return ''

  const json = JSON.parse(text)
  return String(json?.blockID || '')
}

function normalizeHxRows(json) {
  const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : []

  return rows
    .map((item) => ({
      block: Number(item.block || item.blockNumber || item.height || 0),
    }))
    .filter((item) => Number.isInteger(item.block) && item.block > 0)
}

async function buildFixedHistory(latestFixedBlock) {
  const history = []

  for (let i = 0; i < MAX_ITEMS; i++) {
    const block = latestFixedBlock - i * 20
    const hash = await fetchTronBlockHash(block)
    const parsed = parseHashOpenNumber(hash)

    if (!parsed) continue

    history.push({
      block,
      hash,
      sourcePair: parsed.sourcePair,
      openCode: parsed.openCode,
      value: parsed.value,
      tail: parsed.tail,
      parsedByHash: true,
    })
  }

  return history
}

export async function GET() {
  try {
    const json = await fetchJson(HX_HISTORY_URL)
    const rawRows = normalizeHxRows(json)

    if (!rawRows.length) {
      throw new Error('没有获取到哈希1分轮盘区块数据')
    }

    const maxBlock = Math.max(...rawRows.map((item) => item.block))
    const latestFixedBlock = Math.floor(maxBlock / 20) * 20

    const history = await buildFixedHistory(latestFixedBlock)

    if (!history.length) {
      throw new Error('没有解析到固定开奖区块哈希')
    }

    const latest = history[0]

    return NextResponse.json({
      ok: true,
      play: 'hash1-wheel',
      source: 'hx168.live + trongrid',
      latest,
      nextBlock: Number(latest.block) + 20,
      history,
      updatedAt: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error.message || '获取哈希1分轮盘数据失败',
      },
      { status: 500 }
    )
  }
}
