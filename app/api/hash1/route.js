import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MAX_ITEMS = 220
const TRON_NOW_BLOCK = 'https://api.trongrid.io/wallet/getnowblock'
const TRON_BLOCK_BY_NUM = 'https://api.trongrid.io/wallet/getblockbynum'

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

async function postJson(url, body = {}) {
  const res = await fetch(url, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0',
    },
    body: JSON.stringify(body),
  })

  const text = await res.text()

  if (!res.ok) throw new Error(`波场接口请求失败：${url}`)
  if (!text.trim()) throw new Error(`波场接口返回空内容：${url}`)
  if (text.trim().startsWith('<')) throw new Error(`波场接口返回网页：${url}`)

  return JSON.parse(text)
}

async function getNowBlock() {
  const json = await postJson(TRON_NOW_BLOCK)

  const blockNumber =
    json?.block_header?.raw_data?.number ||
    json?.blockHeader?.raw_data?.number ||
    json?.number

  const blockID = json?.blockID || json?.blockId || ''

  return {
    blockNumber: Number(blockNumber),
    blockID: String(blockID || ''),
  }
}

async function getBlockByNum(block) {
  try {
    const json = await postJson(TRON_BLOCK_BY_NUM, { num: Number(block) })

    return {
      block: Number(block),
      hash: String(json?.blockID || json?.blockId || ''),
    }
  } catch {
    return {
      block: Number(block),
      hash: '',
    }
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

export async function GET() {
  try {
    const now = await getNowBlock()

    if (!Number.isInteger(now.blockNumber) || now.blockNumber <= 0) {
      throw new Error('没有获取到波场当前区块')
    }

    const latestFixedBlock = Math.floor(now.blockNumber / 20) * 20
    const nextBlock = latestFixedBlock + 20
    const remainBlocks = Math.max(0, nextBlock - now.blockNumber)

    const blocks = Array.from({ length: MAX_ITEMS }, (_, index) => {
      return latestFixedBlock - index * 20
    })

    const rawBlocks = await mapLimit(blocks, 8, getBlockByNum)

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
      throw new Error('没有解析到固定开奖区块哈希')
    }

    const latest = history[0]

    return NextResponse.json({
      ok: true,
      play: 'hash1-wheel',
      source: 'trongrid',
      currentBlock: now.blockNumber,
      latestFixedBlock,
      latest,
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
        message: error.message || '获取波场哈希1分轮盘数据失败',
      },
      {
        status: 500,
      }
    )
  }
}
