import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MAX_ITEMS = 220
const TRONSCAN_BLOCK_API = 'https://apilist.tronscanapi.com/api/block'
const TRONSCAN_API_KEY = process.env.TRONSCAN_API_KEY || ''

function isDigit(ch) {
  return ch >= '0' && ch <= '9'
}

// 从哈希末尾往前找两位连续数字，反转后在 00-35 内作为开奖结果
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
  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      accept: 'application/json,text/plain,*/*',
      'user-agent': 'Mozilla/5.0',
      ...(TRONSCAN_API_KEY
        ? { 'TRON-PRO-API-KEY': TRONSCAN_API_KEY }
        : {}),
    },
  })

  const text = await res.text()

  if (!res.ok) throw new Error(`TronScan接口失败：${url}`)
  if (!text.trim()) throw new Error(`TronScan接口返回空内容：${url}`)
  if (text.trim().startsWith('<')) throw new Error(`TronScan接口返回网页：${url}`)

  return JSON.parse(text)
}

function pickBlockItem(json) {
  if (Array.isArray(json?.data)) return json.data[0]
  if (Array.isArray(json?.rows)) return json.rows[0]
  if (Array.isArray(json)) return json[0]
  return json
}

function getBlockNumberFromItem(item) {
  return Number(
    item?.number ??
    item?.block ??
    item?.blockNumber ??
    item?.height ??
    item?.block_header?.raw_data?.number ??
    0
  )
}

function getHashFromItem(item) {
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
    `${TRONSCAN_BLOCK_API}?sort=-number&limit=1&_t=${Date.now()}`
  )

  const item = pickBlockItem(json)
  const blockNumber = getBlockNumberFromItem(item)
  const hash = getHashFromItem(item)

  if (!Number.isInteger(blockNumber) || blockNumber <= 0) {
    throw new Error('TronScan没有返回最新区块号')
  }

  return {
    blockNumber,
    hash,
  }
}

async function getBlockHash(block) {
  const json = await fetchTronScan(
    `${TRONSCAN_BLOCK_API}?number=${Number(block)}&_t=${Date.now()}`
  )

  const item = pickBlockItem(json)
  return getHashFromItem(item)
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

export async function GET() {
  try {
    const latestBlockData = await getLatestBlock()
    const currentBlock = latestBlockData.blockNumber

    // 只取 00 / 20 / 40 / 60 / 80 的开奖区块
    const latestFixedBlock = currentBlock - (currentBlock % 20)
    const nextBlock = latestFixedBlock + 20
    const remainBlocks = Math.max(0, nextBlock - currentBlock)

    const blocks = Array.from({ length: MAX_ITEMS }, (_, index) => {
      return latestFixedBlock - index * 20
    })

    const rawBlocks = await mapLimit(blocks, 6, async (block) => {
      try {
        const hash = await getBlockHash(block)
        return {
          block,
          hash,
        }
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

    return NextResponse.json({
      ok: true,
      play: 'hash1-wheel',
      source: 'tronscan',
      currentBlock,
      latestFixedBlock,
      latest: history[0],
      nextBlock,
      remainBlocks,
      countdownSeconds: remainBlocks * 3,
      history,
      updatedAt: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error.message || '获取TronScan波场区块数据失败',
      },
      {
        status: 500,
      }
    )
  }
}
