import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MAX_ITEMS = 220
const MIN_OPEN = 0
const MAX_OPEN = 36
const HX_URLS = [
  'https://hx168.live/api/Game/GetGameListByDate?gameId=1',
  'https://hx168.live/api/Game/GetGameLastList?status=2&gameId=1',
]

function isDigit(ch) {
  return ch >= '0' && ch <= '9'
}

// 37个号码版：从哈希末尾往前找两位连续数字，反转后 00-36 为有效开奖号。
function parseHashOpenNumber(hash) {
  const text = String(hash || '').toLowerCase()

  for (let i = text.length - 1; i >= 1; i--) {
    const left = text[i - 1]
    const right = text[i]

    if (isDigit(left) && isDigit(right)) {
      const sourcePair = `${left}${right}`
      const openCode = `${right}${left}`
      const value = Number(openCode)

      if (Number.isInteger(value) && value >= MIN_OPEN && value <= MAX_OPEN) {
        return { sourcePair, openCode: openCode.padStart(2, '0'), value, tail: value % 10 }
      }
    }
  }

  return null
}

async function fetchJson(url) {
  const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`, {
    cache: 'no-store',
    headers: { accept: 'application/json,text/plain,*/*', 'user-agent': 'Mozilla/5.0' },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`接口请求失败：${url}`)
  if (!text.trim()) throw new Error(`接口返回空内容：${url}`)
  if (text.trim().startsWith('<')) throw new Error(`接口返回网页：${url}`)
  return JSON.parse(text)
}

function pickRows(json) {
  if (Array.isArray(json?.list)) return json.list
  if (Array.isArray(json?.data)) return json.data
  if (Array.isArray(json?.rows)) return json.rows
  if (Array.isArray(json)) return json
  return []
}

function normalizeRows(json) {
  return pickRows(json)
    .map((item, index) => {
      const block = Number(item.block || item.blockNumber || item.height || 0)
      const hash = String(item.hash || item.blockHash || item.hashCode || item.block_hash || '')
      const parsed = hash ? parseHashOpenNumber(hash) : null
      const fallbackValue = Number(item.lastCode ?? item.num ?? item.openCode ?? item.result ?? NaN)
      const value = parsed?.value ?? (Number.isInteger(fallbackValue) ? fallbackValue : null)
      if (!Number.isInteger(block) || block <= 0) return null
      if (value === null || !Number.isInteger(value)) return null
      if (value < MIN_OPEN || value > MAX_OPEN) return null
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

async function fetchHxData() {
  const errors = []
  for (const url of HX_URLS) {
    try {
      const json = await fetchJson(url)
      const history = normalizeRows(json)
      if (history.length) return { sourceUrl: url, history }
    } catch (error) {
      errors.push(error.message)
    }
  }
  throw new Error(errors[0] || '没有获取到开奖记录')
}

function calcMaxMiss(results) {
  let max = 0
  let current = 0
  results.forEach((hit) => {
    if (hit) current = 0
    else {
      current += 1
      max = Math.max(max, current)
    }
  })
  return max
}

function calcCurrentMiss(results) {
  let current = 0
  for (const hit of results) {
    if (hit) break
    current += 1
  }
  return current
}

function testTails(history, tails, size) {
  const source = history.slice(0, size)
  const set = new Set(tails)
  const results = source.map((item) => set.has(Number(item.tail)))
  const hitCount = results.filter(Boolean).length
  return {
    size,
    testedCount: source.length,
    hitCount,
    missCount: source.length - hitCount,
    hitRate: source.length ? Number(((hitCount / source.length) * 100).toFixed(2)) : 0,
    currentMiss: calcCurrentMiss(results),
    maxMiss: calcMaxMiss(results),
    coverageRate: tails.length * 10,
  }
}

function getCombos(arr, k) {
  const result = []
  function backtrack(start, combo) {
    if (combo.length === k) return result.push([...combo])
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
  const combos = getCombos([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 6)
  const top10 = combos
    .map((tails, index) => {
      const result20 = testTails(history, tails, 20)
      const result50 = testTails(history, tails, 50)
      const result100 = testTails(history, tails, 100)
      const result200 = testTails(history, tails, 200)
      const score = result20.hitRate * 0.45 + result50.hitRate * 0.3 + result100.hitRate * 0.15 + result200.hitRate * 0.1 - result20.maxMiss * 2 - result20.currentMiss * 3
      return { id: `auto-${index + 1}`, name: '', logic: '自动优化', tails, score: Number(score.toFixed(2)), result20, result50, result100, result200 }
    })
    .sort((a, b) => b.score - a.score || b.result20.hitRate - a.result20.hitRate || b.result50.hitRate - a.result50.hitRate || a.result20.currentMiss - b.result20.currentMiss || a.result20.maxMiss - b.result20.maxMiss)
    .slice(0, 10)
    .map((item, index) => ({
      ...item,
      id: `s${index + 1}`,
      name: `方案${index + 1}`,
      logic: index === 0 ? '综合胜率最高' : index === 1 ? '近20优先' : index === 2 ? '近50稳定' : index === 3 ? '低连错优先' : '自动优化',
    }))

  const tailCount = Array.from({ length: 10 }, (_, tail) => ({ tail, count: 0 }))
  top10.forEach((s) => s.tails.forEach((tail) => (tailCount[tail].count += 1)))
  const frequentTails = [...tailCount].sort((a, b) => b.count - a.count || a.tail - b.tail).slice(0, 6).map((i) => i.tail).sort((a, b) => a - b)
  const result20 = testTails(history, frequentTails, 20)
  const result50 = testTails(history, frequentTails, 50)
  const result100 = testTails(history, frequentTails, 100)
  const result200 = testTails(history, frequentTails, 200)
  const strategy11 = { id: 's11', name: '方案11', logic: '10档高频尾', tails: frequentTails, score: 0, result20, result50, result100, result200, tailFrequency: tailCount }
  strategy11.score = Number((result20.hitRate * 0.45 + result50.hitRate * 0.3 + result100.hitRate * 0.15 + result200.hitRate * 0.1 - result20.maxMiss * 2 - result20.currentMiss * 3).toFixed(2))
  return [...top10, strategy11]
}

export async function GET() {
  try {
    const { sourceUrl, history } = await fetchHxData()
    if (!history.length) throw new Error('没有获取到哈希1分轮盘开奖历史数据')
    const latest = history[0]
    const nextBlock = latest.block + 20
    const optimizedStrategies = buildOptimizedStrategies(history)
    const predictedTails = optimizedStrategies[0]?.tails || [0, 1, 2, 3, 4, 5]
    return NextResponse.json({
      ok: true,
      play: 'hash1-wheel-v21-37',
      openRange: '00-36',
      source: sourceUrl,
      latest,
      latestFixedBlock: latest.block,
      nextBlock,
      countdownSeconds: 0,
      predictedTails,
      optimizedStrategies,
      predictStats: { 20: testTails(history, predictedTails, 20), 50: testTails(history, predictedTails, 50), 100: testTails(history, predictedTails, 100), 200: testTails(history, predictedTails, 200) },
      history,
      updatedAt: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json({ ok: false, message: error.message || '获取哈希1分轮盘数据失败' }, { status: 500 })
  }
}
