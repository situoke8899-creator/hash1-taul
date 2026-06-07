import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const HX_HISTORY_URL = 'https://hx168.live/api/Game/GetGameListByDate?gameId=1'
const TRON_GRID_LATEST = 'https://api.trongrid.io/v1/blocks/latest'
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

      if (Number.isInteger(value) && value >= 0 && value < 36) {
        return {
          sourcePair,
          openCode: openCode.padStart(2, '0'),
          value,
          tail: value % 10,
        }
      }
    }
  }

  return null
}

async function fetchJson(url) {
  const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`, {
    cache: 'no-store',
    headers: {
      accept: 'application/json,text/plain,*/*',
      'user-agent': 'Mozilla/5.0',
    },
  })

  const text = await res.text()

  if (!res.ok) throw new Error(`接口请求失败：${url}`)
  if (!text.trim()) throw new Error(`接口返回空内容：${url}`)
  if (text.trim().startsWith('<')) throw new Error(`接口返回网页：${url}`)

  return JSON.parse(text)
}

function pickFirst(json) {
  if (Array.isArray(json?.data)) return json.data[0]
  if (Array.isArray(json?.rows)) return json.rows[0]
  if (Array.isArray(json)) return json[0]
  return json
}

function getBlockNumber(item) {
  return Number(
    item?.number ??
    item?.block ??
    item?.blockNumber ??
    item?.height ??
    item?.block_header?.raw_data?.number ??
    0
  )
}

async function getCurrentTronBlock() {
  try {
    const json = await fetchJson(TRON_GRID_LATEST)
    const item = pickFirst(json)
    const block = getBlockNumber(item)

    if (Number.isInteger(block) && block > 0) {
      return block
    }
  } catch {}

  return 0
}

function normalizeHxRows(json) {
  const rows =
    Array.isArray(json?.list)
      ? json.list
      : Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json)
      ? json
      : []

  return rows
    .map((item, index) => {
      const block = Number(item.block || item.blockNumber || item.height || 0)
      const hash = String(item.hash || item.blockHash || item.hashCode || item.block_hash || '')
      const parsed = hash ? parseHashOpenNumber(hash) : null

      const rawNum = Number(
        item.lastCode ??
          item.num ??
          item.openCode ??
          item.result ??
          NaN
      )

      const value = parsed?.value ?? (Number.isInteger(rawNum) ? rawNum : null)

      if (!Number.isInteger(block) || block <= 0) return null
      if (value === null || !Number.isInteger(value)) return null

      return {
        index,
        block,
        hash,
        sourcePair: parsed?.sourcePair || '',
        openCode: parsed?.openCode || String(value).padStart(2, '0'),
        value,
        tail: Math.abs(value) % 10,
        parsedByHash: Boolean(parsed),
        openTime: item.time || item.openTime || item.createTime || item.createdAt || '',
        drawResult: item.drawResult || '',
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.block - a.block)
    .slice(0, MAX_ITEMS)
}

function buildPredictSix(history) {
  const score = Array.from({ length: 10 }, (_, tail) => ({
    tail,
    score: 0,
    count20: 0,
    count50: 0,
    count100: 0,
    count200: 0,
    omit: 0,
  }))

  history.slice(0, 20).forEach((item) => {
    score[item.tail].score += 5
    score[item.tail].count20 += 1
  })

  history.slice(0, 50).forEach((item) => {
    score[item.tail].score += 3
    score[item.tail].count50 += 1
  })

  history.slice(0, 100).forEach((item) => {
    score[item.tail].score += 1.5
    score[item.tail].count100 += 1
  })

  history.slice(0, 200).forEach((item) => {
    score[item.tail].score += 0.5
    score[item.tail].count200 += 1
  })

  score.forEach((item) => {
    const index = history.findIndex((row) => row.tail === item.tail)
    item.omit = index === -1 ? history.length : index

    if (item.omit >= 8) item.score += 5
    if (item.omit >= 15) item.score += 8
  })

  return score
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.count20 !== a.count20) return b.count20 - a.count20
      if (b.omit !== a.omit) return b.omit - a.omit
      return a.tail - b.tail
    })
    .slice(0, 6)
    .map((item) => item.tail)
    .sort((a, b) => a - b)
}

function testTails(history, tails, size) {
  const source = history.slice(0, size)
  const set = new Set(tails)
  const hitCount = source.filter((item) => set.has(item.tail)).length

  let currentMiss = 0
  for (const item of source) {
    if (set.has(item.tail)) break
    currentMiss += 1
  }

  return {
    size,
    testedCount: source.length,
    hitCount,
    hitRate: source.length
      ? Number(((hitCount / source.length) * 100).toFixed(2))
      : 0,
    currentMiss,
  }
}

function calcCountdown(latest, currentBlock, nextBlock) {
  if (currentBlock > 0) {
    const remainBlocks = Math.max(0, nextBlock - currentBlock)
    return {
      remainBlocks,
      countdownSeconds: remainBlocks * 3,
    }
  }

  const latestTime = new Date(latest.openTime || '').getTime()

  if (Number.isFinite(latestTime) && latestTime > 0) {
    const nextTime = latestTime + 60 * 1000
    return {
      remainBlocks: 0,
      countdownSeconds: Math.max(0, Math.floor((nextTime - Date.now()) / 1000)),
    }
  }

  return {
    remainBlocks: 0,
    countdownSeconds: 0,
  }
}

export async function GET() {
  try {
    const hxJson = await fetchJson(HX_HISTORY_URL)
    const history = normalizeHxRows(hxJson)

    if (!history.length) {
      throw new Error('没有获取到 hx168 开奖历史数据')
    }

    const latest = history[0]
    const currentBlock = await getCurrentTronBlock()

    const latestFixedBlock = latest.block
    const nextBlock = latest.block + 20
    const { remainBlocks, countdownSeconds } = calcCountdown(latest, currentBlock, nextBlock)

    const predictedTails = buildPredictSix(history)

    return NextResponse.json({
      ok: true,
      play: 'hash1-wheel',
      source: 'hx168-history + trongrid-current',
      currentBlock,
      latestFixedBlock,
      latest,
      nextBlock,
      remainBlocks,
      countdownSeconds,
      predictedTails,
      predictStats: {
        20: testTails(history, predictedTails, 20),
        50: testTails(history, predictedTails, 50),
        100: testTails(history, predictedTails, 100),
        200: testTails(history, predictedTails, 200),
      },
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
