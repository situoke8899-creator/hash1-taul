import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MAX_ITEMS = 220
const TRON_GRID_V1 = 'https://api.trongrid.io/v1/blocks'

function isDigit(ch) {
  return ch >= '0' && ch <= '9'
}

// 从哈希末尾往前找两位连续数字，反转后 00-35 为开奖结果
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

  if (!res.ok) throw new Error(`TronGrid接口失败：${url}`)
  if (!text.trim()) throw new Error(`TronGrid接口返回空内容：${url}`)
  if (text.trim().startsWith('<')) throw new Error(`TronGrid接口返回网页：${url}`)

  return JSON.parse(text)
}

function pickBlockItem(json) {
  if (Array.isArray(json?.data)) return json.data[0]
  if (Array.isArray(json)) return json[0]
  return json
}

function getBlockNumber(item) {
  return Number(
    item?.number ??
    item?.block_number ??
    item?.blockNumber ??
    item?.height ??
    item?.block_header?.raw_data?.number ??
    0
  )
}

function getBlockHash(item) {
  return String(
    item?.hash ??
    item?.blockID ??
    item?.blockId ??
    item?.block_hash ??
    ''
  )
}

async function getLatestBlock() {
  const json = await fetchJson(`${TRON_GRID_V1}/latest`)
  const item = pickBlockItem(json)

  const blockNumber = getBlockNumber(item)
  const hash = getBlockHash(item)

  if (!Number.isInteger(blockNumber) || blockNumber <= 0) {
    throw new Error('没有获取到波场最新区块号')
  }

  return {
    blockNumber,
    hash,
  }
}

async function getBlockByNumber(blockNumber) {
  const json = await fetchJson(`${TRON_GRID_V1}/${Number(blockNumber)}`)
  const item = pickBlockItem(json)

  return {
    block: Number(blockNumber),
    hash: getBlockHash(item),
  }
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

  const ranking = score.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.count20 !== a.count20) return b.count20 - a.count20
    if (b.omit !== a.omit) return b.omit - a.omit
    return a.tail - b.tail
  })

  return ranking.slice(0, 6).map((item) => item.tail).sort((a, b) => a - b)
}

function calcCurrentMiss(history, tails, size) {
  const set = new Set(tails)
  let miss = 0

  for (const item of history.slice(0, size)) {
    if (set.has(item.tail)) break
    miss += 1
  }

  return miss
}

function testTails(history, tails, size) {
  const source = history.slice(0, size)
  const set = new Set(tails)
  const hitCount = source.filter((item) => set.has(item.tail)).length

  return {
    size,
    testedCount: source.length,
    hitCount,
    hitRate: source.length ? Number(((hitCount / source.length) * 100).toFixed(2)) : 0,
    currentMiss: calcCurrentMiss(history, tails, size),
  }
}

export async function GET() {
  try {
    const latestBlock = await getLatestBlock()
    const currentBlock = latestBlock.blockNumber

    // 只取区块号尾数为 00 / 20 / 40 / 60 / 80 的区块
    const latestFixedBlock = currentBlock - (currentBlock % 20)
    const nextBlock = latestFixedBlock + 20
    const remainBlocks = Math.max(0, nextBlock - currentBlock)

    const blocks = Array.from({ length: MAX_ITEMS }, (_, index) => {
      return latestFixedBlock - index * 20
    })

    const rawBlocks = await mapLimit(blocks, 6, async (block) => {
      try {
        return await getBlockByNumber(block)
      } catch {
        return {
          block,
          hash: '',
        }
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
      throw new Error('没有解析到 00/20/40/60/80 固定开奖区块哈希')
    }

    const predictedTails = buildPredictSix(history)

    return NextResponse.json({
      ok: true,
      play: 'hash1-wheel',
      source: 'trongrid-v1-blocks',
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
