import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MAX_ITEMS = 220
const TRONSCAN_API = 'https://apilist.tronscanapi.com/api/block'
const TRONSCAN_API_KEY = process.env.TRONSCAN_API_KEY || ''

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

async function fetchTronScan(url) {
  if (!TRONSCAN_API_KEY) {
    throw new Error('缺少 TRONSCAN_API_KEY，请先在 Vercel 环境变量里添加')
  }

  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      accept: 'application/json,text/plain,*/*',
      'user-agent': 'Mozilla/5.0',
      'TRON-PRO-API-KEY': TRONSCAN_API_KEY,
    },
  })

  const text = await res.text()

  if (!res.ok) {
    throw new Error(`TronScan接口失败：${url}｜${res.status}`)
  }

  if (!text.trim()) {
    throw new Error(`TronScan接口返回空内容：${url}`)
  }

  if (text.trim().startsWith('<')) {
    throw new Error(`TronScan接口返回网页：${url}`)
  }

  return JSON.parse(text)
}

function pickBlockItem(json) {
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
    0
  )
}

function getBlockHash(item) {
  return String(
    item?.hash ??
    item?.blockHash ??
    item?.blockID ??
    item?.blockId ??
    ''
  )
}

async function getLatestBlock() {
  const json = await fetchTronScan(
    `${TRONSCAN_API}?sort=-number&limit=1&_t=${Date.now()}`
  )

  const item = pickBlockItem(json)
  const blockNumber = getBlockNumber(item)

  if (!Number.isInteger(blockNumber) || blockNumber <= 0) {
    throw new Error('TronScan没有返回最新区块号')
  }

  return blockNumber
}

async function getBlockHashByNumber(block) {
  const json = await fetchTronScan(
    `${TRONSCAN_API}?number=${Number(block)}&_t=${Date.now()}`
  )

  const item = pickBlockItem(json)
  return getBlockHash(item)
}

async function mapLimit(items, limit, mapper) {
  const result = []
  let index = 0

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++
      result[currentIndex] = await mapper(items[currentIndex], currentIndex)
    }
  }

  await Promise.all(Array.from({ length: limit }, worker))
  return result
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

export async function GET() {
  try {
    const currentBlock = await getLatestBlock()

    // 只取 00 / 20 / 40 / 60 / 80 区块
    const latestFixedBlock = currentBlock - (currentBlock % 20)
    const nextBlock = latestFixedBlock + 20
    const remainBlocks = Math.max(0, nextBlock - currentBlock)

    const blocks = Array.from({ length: MAX_ITEMS }, (_, index) => {
      return latestFixedBlock - index * 20
    })

    const rawBlocks = await mapLimit(blocks, 6, async (block) => {
      try {
        const hash = await getBlockHashByNumber(block)
        return { block, hash }
      } catch {
        return { block, hash: '' }
      }
    })

    const history = rawBlocks
      .map((item) => {
        const parsed = parseHashOpenNumber(item.hash)
        if (!parsed) return null

        return {
          block: item.block,
          hash: item.hash,
          sourcePair: parsed.sourcePair,
          openCode: parsed.openCode,
          value: parsed.value,
          tail: parsed.tail,
          parsedByHash: true,
        }
      })
      .filter(Boolean)

    if (!history.length) {
      throw new Error('没有解析到 00/20/40/60/80 固定区块哈希')
    }

    const predictedTails = buildPredictSix(history)

    return NextResponse.json({
      ok: true,
      play: 'hash1-wheel',
      source: 'tronscan-api',
      currentBlock,
      latestFixedBlock,
      latest: history[0],
      nextBlock,
      remainBlocks,
      countdownSeconds: remainBlocks * 3,
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
        message: error.message || '获取波场区块数据失败',
      },
      { status: 500 }
    )
  }
}
