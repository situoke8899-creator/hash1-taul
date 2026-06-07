import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MAX_ITEMS = 220

const HX_URLS = [
  'https://hx168.live/api/Game/GetGameListByDate?gameId=1',
  'https://hx168.live/api/Game/GetGameLastList?status=2&gameId=1',
]

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

async function fetchHxData() {
  const errors = []

  for (const url of HX_URLS) {
    try {
      const json = await fetchJson(url)
      const rows = normalizeRows(json)

      if (rows.length) {
        return {
          sourceUrl: url,
          history: rows,
        }
      }
    } catch (err) {
      errors.push(err.message)
    }
  }

  throw new Error(errors[0] || '没有获取到开奖记录')
}

function normalizeRows(json) {
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

      const fallbackValue = Number(
        item.lastCode ??
          item.num ??
          item.openCode ??
          item.result ??
          NaN
      )

      const value = parsed?.value ?? (Number.isInteger(fallbackValue) ? fallbackValue : null)

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

function testTails(history, tails, size) {
  const source = history.slice(0, size)
  const set = new Set(tails)

  let hitCount = 0
  let currentMiss = 0
  let maxMiss = 0
  let tempMiss = 0

  source.forEach((item, index) => {
    const hit = set.has(item.tail)

    if (hit) {
      hitCount += 1
      tempMiss = 0
    } else {
      tempMiss += 1
      maxMiss = Math.max(maxMiss, tempMiss)
      if (index === currentMiss) currentMiss += 1
    }
  })

  return {
    size,
    testedCount: source.length,
    hitCount,
    missCount: source.length - hitCount,
    hitRate: source.length ? Number(((hitCount / source.length) * 100).toFixed(2)) : 0,
    currentMiss,
    maxMiss,
  }
}

function getCombos(arr, k) {
  const result = []

  function backtrack(start, combo) {
    if (combo.length === k) {
      result.push([...combo])
      return
    }

    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i])
      backtrack(i + 1, combo)
      combo.pop()
    }
  }

  backtrack(0, [])
  return result
}

function buildOptimizedStrategies(history) {
  const allTails = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
  const combos = getCombos(allTails, 6)

  return combos
    .map((tails, index) => {
      const result20 = testTails(history, tails, 20)
      const result50 = testTails(history, tails, 50)
      const result100 = testTails(history, tails, 100)
      const result200 = testTails(history, tails, 200)

      const score =
        result20.hitRate * 0.45 +
        result50.hitRate * 0.3 +
        result100.hitRate * 0.15 +
        result200.hitRate * 0.1 -
        result20.maxMiss * 2 -
        result20.currentMiss * 3

      return {
        id: `auto-${index + 1}`,
        name: '',
        logic: '自动优化',
        tails,
        score: Number(score.toFixed(2)),
        result20,
        result50,
        result100,
        result200,
      }
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.result20.hitRate !== a.result20.hitRate) return b.result20.hitRate - a.result20.hitRate
      if (b.result50.hitRate !== a.result50.hitRate) return b.result50.hitRate - a.result50.hitRate
      if (a.result20.currentMiss !== b.result20.currentMiss) return a.result20.currentMiss - b.result20.currentMiss
      return a.result20.maxMiss - b.result20.maxMiss
    })
    .slice(0, 10)
    .map((item, index) => ({
      ...item,
      id: `s${index + 1}`,
      name: `方案${index + 1}`,
      logic:
        index === 0
          ? '综合胜率最高'
          : index === 1
          ? '近20优先'
          : index === 2
          ? '近50稳定'
          : index === 3
          ? '低连错优先'
          : '自动优化',
    }))
}

function buildPredictSix(history) {
  const strategies = buildOptimizedStrategies(history)
  return strategies[0]?.tails || [0, 1, 2, 3, 4, 5]
}

export async function GET() {
  try {
    const { sourceUrl, history } = await fetchHxData()

    if (!history.length) {
      throw new Error('没有获取到开奖记录')
    }

    const latest = history[0]
    const nextBlock = latest.block + 20
    const optimizedStrategies = buildOptimizedStrategies(history)
    const predictedTails = optimizedStrategies[0]?.tails || buildPredictSix(history)

    return NextResponse.json({
      ok: true,
      play: 'hash1-wheel',
      source: sourceUrl,
      latest,
      latestFixedBlock: latest.block,
      nextBlock,
      predictedTails,
      optimizedStrategies,
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
