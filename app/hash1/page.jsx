'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

const WINDOWS = [20, 50, 100, 200]

function fmtPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`
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

function buildTailHeat(history, size) {
  const source = history.slice(0, size)
  const rows = Array.from({ length: 10 }, (_, tail) => ({
    tail,
    count: 0,
    omit: source.length,
    lastIndex: -1,
    rate: 0,
  }))

  source.forEach((item, index) => {
    const tail = Number(item.tail)
    if (!Number.isInteger(tail)) return
    rows[tail].count += 1
    if (rows[tail].lastIndex === -1) rows[tail].lastIndex = index
  })

  return rows.map((row) => ({
    ...row,
    omit: row.lastIndex === -1 ? source.length : row.lastIndex,
    rate: source.length ? (row.count / source.length) * 100 : 0,
  }))
}

function predictSixTails(history) {
  const heat20 = buildTailHeat(history, 20)
  const heat50 = buildTailHeat(history, 50)
  const heat100 = buildTailHeat(history, 100)
  const heat200 = buildTailHeat(history, 200)

  const scores = Array.from({ length: 10 }, (_, tail) => {
    const h20 = heat20[tail]
    const h50 = heat50[tail]
    const h100 = heat100[tail]
    const h200 = heat200[tail]

    const trend = h20.count - h50.count * 0.4
    const omitBonus = Math.min(h200.omit, 18) * 0.75
    const score = h20.count * 5 + h50.count * 2.5 + h100.count * 1.1 + trend * 2 + omitBonus

    return {
      tail,
      score: Number(score.toFixed(2)),
      count20: h20.count,
      count50: h50.count,
      count100: h100.count,
      count200: h200.count,
      omit: h200.omit,
      trend: Number(trend.toFixed(2)),
    }
  })

  const selected = [...scores]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.count20 !== a.count20) return b.count20 - a.count20
      if (b.omit !== a.omit) return b.omit - a.omit
      return a.tail - b.tail
    })
    .slice(0, 6)
    .map((item) => item.tail)
    .sort((a, b) => a - b)

  return { tails: selected, scores: scores.sort((a, b) => b.score - a.score) }
}

function testTails(history, tails, size) {
  const source = history.slice(0, size)
  const set = new Set(tails)
  const rows = source.map((item) => ({ ...item, hit: set.has(Number(item.tail)) }))
  const results = rows.map((item) => item.hit)
  const testedCount = rows.length
  const hitCount = rows.filter((item) => item.hit).length

  return {
    testedCount,
    hitCount,
    missCount: testedCount - hitCount,
    hitRate: testedCount ? (hitCount / testedCount) * 100 : 0,
    coverageRate: tails.length * 10,
    maxMiss: calcMaxMiss(results),
    currentMiss: calcCurrentMiss(results),
    rows,
  }
}

function buildTailStrategies(history) {
  const heat20 = buildTailHeat(history, 20)
  const heat50 = buildTailHeat(history, 50)
  const heat200 = buildTailHeat(history, 200)

  const hot20 = [...heat20].sort((a, b) => b.count - a.count || a.tail - b.tail).map((i) => i.tail)
  const hot50 = [...heat50].sort((a, b) => b.count - a.count || a.tail - b.tail).map((i) => i.tail)
  const cold200 = [...heat200].sort((a, b) => b.omit - a.omit || a.tail - b.tail).map((i) => i.tail)
  const balanced = [0, 1, 2, 3, 5, 7]

  const raw = [
    { name: '方案1', logic: '20期热尾', tails: hot20.slice(0, 6) },
    { name: '方案2', logic: '50期热尾', tails: hot50.slice(0, 6) },
    { name: '方案3', logic: '热4冷2', tails: [...hot20.slice(0, 4), ...cold200.slice(0, 2)] },
    { name: '方案4', logic: '热3冷3', tails: [...hot50.slice(0, 3), ...cold200.slice(0, 3)] },
    { name: '方案5', logic: '遗漏补位', tails: cold200.slice(0, 6) },
    { name: '方案6', logic: '小尾防守', tails: [0, 1, 2, 3, 4, 5] },
    { name: '方案7', logic: '大尾防守', tails: [4, 5, 6, 7, 8, 9] },
    { name: '方案8', logic: '奇尾偏强', tails: [1, 3, 5, 6, 7, 9] },
    { name: '方案9', logic: '偶尾补位', tails: [0, 2, 4, 5, 6, 8] },
    { name: '方案10', logic: '均衡覆盖', tails: balanced },
  ]

  return raw.map((item, index) => {
    const tails = Array.from(new Set(item.tails)).slice(0, 6).sort((a, b) => a - b)
    while (tails.length < 6) {
      const next = hot50.find((tail) => !tails.includes(tail))
      if (next === undefined) break
      tails.push(next)
    }
    tails.sort((a, b) => a - b)

    const result20 = testTails(history, tails, 20)
    const result50 = testTails(history, tails, 50)
    const result100 = testTails(history, tails, 100)
    const result200 = testTails(history, tails, 200)
    const score = result20.hitRate * 0.45 + result50.hitRate * 0.3 + result100.hitRate * 0.15 + result200.hitRate * 0.1 - result20.maxMiss * 1.2

    return { id: `s${index + 1}`, ...item, tails, result20, result50, result100, result200, score }
  }).sort((a, b) => b.score - a.score || b.result20.hitRate - a.result20.hitRate)
}

function TailBadge({ tail, active = true }) {
  return <span className={active ? 'tail active' : 'tail'}>{tail}</span>
}

function freezeKey(block) {
  return `hash1-v21-37-prediction-${block}`
}

function safeParse(raw) {
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function compactStrategy(strategy) {
  return {
    id: strategy.id,
    name: strategy.name,
    logic: strategy.logic,
    tails: Array.isArray(strategy.tails) ? strategy.tails : [],
  }
}

function readFrozenPrediction(block) {
  if (typeof window === 'undefined' || !block) return null

  try {
    return safeParse(
      window.localStorage.getItem(freezeKey(block))
    )
  } catch {
    return null
  }
}

function saveFrozenPrediction(record) {
  if (typeof window === 'undefined' || !record?.block) return record

  try {
    window.localStorage.setItem(
      freezeKey(record.block),
      JSON.stringify(record)
    )
  } catch {
    // 浏览器隐私模式、储存空间不足或禁止localStorage时，
    // 不让页面因此发生客户端崩溃。
  }

  return record
}

function freezeNextPrediction(data, strategies) {
  if (typeof window === 'undefined') return null
  if (!data?.nextBlock || !Array.isArray(strategies) || !strategies.length) return null

  const old = readFrozenPrediction(data.nextBlock)
  if (old) return old

  const record = {
    block: data.nextBlock,
    type: 'real_pre_draw',
    backfilled: false,
    strategies: strategies.map(compactStrategy),
    predictedTails: Array.isArray(data.predictedTails) ? data.predictedTails : strategies[0]?.tails || [],
    source: data.source || '',
    createdAt: Date.now(),
  }

  return saveFrozenPrediction(record)
}

function getOrCreatePredictionForBlock(draw, strategies) {
  if (typeof window === 'undefined') return null
  if (!draw?.block || !Array.isArray(strategies) || !strategies.length) return null

  const old = readFrozenPrediction(draw.block)

  if (old) {
    // 已经有真实冻结或历史补冻结：保持原有方案不变。
    // 但如果后来新增了方案11等新方案，给缺失方案补一次，避免页面出现“无”。
    const oldIds = new Set((old.strategies || []).map((item) => item.id))
    const missing = strategies.filter((strategy) => !oldIds.has(strategy.id)).map((strategy) => ({
      ...compactStrategy(strategy),
      backfilledStrategy: true,
    }))

    if (missing.length) {
      const merged = {
        ...old,
        strategies: [...(old.strategies || []), ...missing],
        mergedMissingStrategyAt: Date.now(),
      }
      return saveFrozenPrediction(merged)
    }

    return old
  }

  // 没有开奖前真实冻结时，用系统当前预测方案补建一次历史冻结，并永久保存。
  const record = {
    block: draw.block,
    type: 'history_backfill',
    backfilled: true,
    openCode: draw.openCode,
    tail: draw.tail,
    hash: draw.hash,
    sourcePair: draw.sourcePair,
    openTime: draw.openTime,
    strategies: strategies.map((strategy) => ({
      ...compactStrategy(strategy),
      backfilledStrategy: true,
    })),
    predictedTails: strategies[0]?.tails || [],
    createdAt: Date.now(),
  }

  return saveFrozenPrediction(record)
}

function buildFrozenRowsForStrategy(history, strategy, strategies) {
  if (!strategy) return []

  return history.slice(0, 20).map((draw) => {
    const frozen = getOrCreatePredictionForBlock(draw, strategies)
    const frozenStrategy = frozen?.strategies?.find((item) => item.id === strategy.id) || compactStrategy(strategy)
    const hit = (frozenStrategy.tails || []).includes(Number(draw.tail))

    return {
      block: draw.block,
      openCode: draw.openCode,
      tail: draw.tail,
      hash: draw.hash,
      sourcePair: draw.sourcePair,
      openTime: draw.openTime,
      strategyId: frozenStrategy.id,
      strategyName: frozenStrategy.name,
      strategyLogic: frozenStrategy.logic,
      tails: frozenStrategy.tails || [],
      hit,
      backfilled: Boolean(frozen?.backfilled || frozenStrategy.backfilledStrategy),
      freezeType: frozen?.type || 'unknown',
    }
  })
}

function buildStrategyFreezeStats(history, strategies) {
  return strategies.map((strategy) => {
    const rows = buildFrozenRowsForStrategy(history, strategy, strategies)
    const hitCount = rows.filter((row) => row.hit).length
    const testedCount = rows.length

    let currentMiss = 0
    for (const row of rows) {
      if (row.hit) break
      currentMiss += 1
    }

    return {
      strategy,
      rows,
      hitCount,
      testedCount,
      hitRate: testedCount ? (hitCount / testedCount) * 100 : 0,
      currentMiss,
    }
  })
}


function buildFrozenStatsBySize(history, strategy, strategies, size) {
  if (!strategy || !Array.isArray(history) || !history.length) {
    return {
      rows: [],
      testedCount: 0,
      hitCount: 0,
      hitRate: 0,
      maxMiss: 0,
      currentMiss: 0,
    }
  }

  const rows = history.slice(0, size).map((draw) => {
    // 这里只读取已经同步好的冻结记录，禁止在React渲染阶段写localStorage。
    const frozen = readFrozenPrediction(draw.block)
    const frozenStrategy =
      frozen?.strategies?.find((item) => item.id === strategy.id) ||
      compactStrategy(strategy)

    const hit = (frozenStrategy.tails || []).includes(Number(draw.tail))

    return {
      block: draw.block,
      openCode: draw.openCode,
      tail: Number(draw.tail),
      tails: frozenStrategy.tails || [],
      hit,
      backfilled: Boolean(
        frozen?.backfilled ||
        frozenStrategy.backfilledStrategy
      ),
    }
  })

  const results = rows.map((row) => row.hit)
  const testedCount = rows.length
  const hitCount = rows.filter((row) => row.hit).length

  return {
    rows,
    testedCount,
    hitCount,
    hitRate: testedCount
      ? (hitCount / testedCount) * 100
      : 0,
    maxMiss: calcMaxMiss(results),
    currentMiss: calcCurrentMiss(results),
  }
}

function buildBestFrozenSixTailStrategy(history, strategies) {
  if (!Array.isArray(strategies) || !strategies.length) return null

  const ranked = strategies.map((strategy) => {
    const frozen20 = buildFrozenStatsBySize(
      history,
      strategy,
      strategies,
      20
    )
    const frozen30 = buildFrozenStatsBySize(
      history,
      strategy,
      strategies,
      30
    )
    const frozen50 = buildFrozenStatsBySize(
      history,
      strategy,
      strategies,
      50
    )

    // 只使用用户指定的20、30、50期冻结记录。
    // 最近20期权重最高，同时扣除连错，避免只看单一命中率。
    const score =
      frozen20.hitRate * 0.5 +
      frozen30.hitRate * 0.3 +
      frozen50.hitRate * 0.2 -
      frozen20.maxMiss * 1.2 -
      frozen20.currentMiss * 0.6

    return {
      strategy,
      frozen20,
      frozen30,
      frozen50,
      score: Number(score.toFixed(3)),
    }
  })

  return ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.frozen20.hitRate !== a.frozen20.hitRate) {
      return b.frozen20.hitRate - a.frozen20.hitRate
    }
    if (b.frozen30.hitRate !== a.frozen30.hitRate) {
      return b.frozen30.hitRate - a.frozen30.hitRate
    }
    return a.frozen20.maxMiss - b.frozen20.maxMiss
  })[0]
}

export default function Hash1Page() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [betAmount, setBetAmount] = useState(100)
  const [odds, setOdds] = useState(37)
  const [selectedStrategyId, setSelectedStrategyId] = useState('s1')
  const [frozenRecords, setFrozenRecords] = useState([])
  const [strategyFreezeStats, setStrategyFreezeStats] = useState([])
  const [bestFrozenStrategy, setBestFrozenStrategy] = useState(null)
  const [bestCopied, setBestCopied] = useState(false)
  const requestInFlight = useRef(false)

  async function loadData() {
    if (requestInFlight.current) return

    requestInFlight.current = true
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/hash1', { cache: 'no-store' })
      const responseText = await res.text()

      if (responseText.trim().startsWith('<')) {
        throw new Error(
          `/api/hash1 返回网页而不是JSON（HTTP ${res.status}）`
        )
      }

      const json = JSON.parse(responseText)

      if (!res.ok || !json.ok) {
        throw new Error(json.message || '接口请求失败')
      }

      setData(json)
    } catch (err) {
      setError(err.message || '加载失败')
    } finally {
      setLoading(false)
      requestInFlight.current = false
    }
  }

  useEffect(() => {
    // 页面首次打开时立即加载一次
    loadData()

    // 每5秒自动刷新一次
    const timer = setInterval(() => {
      loadData()
    }, 5000)

    // 页面离开时清除定时器，避免重复刷新
    return () => clearInterval(timer)
  }, [])

  const history = data?.history || []

  const strategies = useMemo(() => {
    return Array.isArray(data?.optimizedStrategies) && data.optimizedStrategies.length
      ? data.optimizedStrategies
      : buildTailStrategies(history)
  }, [data?.optimizedStrategies, history])

  const prediction = useMemo(() => {
    const local = predictSixTails(history)

    return {
      tails: Array.isArray(data?.predictedTails) && data.predictedTails.length
        ? data.predictedTails
        : local.tails,
      scores: local.scores,
    }
  }, [data?.predictedTails, history])

  const predTests = useMemo(() => {
    if (data?.predictStats) return data.predictStats

    const tails = prediction.tails
    return Object.fromEntries(WINDOWS.map((size) => [size, testTails(history, tails, size)]))
  }, [data?.predictStats, history, prediction.tails])

  const heat200 = useMemo(() => buildTailHeat(history, 200), [history])

  const selectedStrategy =
    strategies.find((item) => item.id === selectedStrategyId) || strategies[0]


  const amountNumber = Number(betAmount || 0)
  const oddsNumber = Number(odds || 0)
  const totalBet = amountNumber * 6
  const winReturn = amountNumber * oddsNumber
  const profit = winReturn - totalBet
  const loseAmount = totalBet

  useEffect(() => {
    if (!data || !strategies.length) return
    freezeNextPrediction(data, strategies)
  }, [data, strategies])

  useEffect(() => {
    if (!history.length || !strategies.length) {
      setFrozenRecords([])
      setStrategyFreezeStats([])
      setBestFrozenStrategy(null)
      return
    }

    try {
      // 先在Effect内统一同步最近50期冻结记录。
      // 这样不会在React渲染/useMemo阶段写localStorage。
      history.slice(0, 50).forEach((draw) => {
        getOrCreatePredictionForBlock(draw, strategies)
      })

      const freezeStats = buildStrategyFreezeStats(
        history,
        strategies
      )

      setStrategyFreezeStats(freezeStats)

      setBestFrozenStrategy(
        buildBestFrozenSixTailStrategy(
          history,
          strategies
        )
      )

      if (selectedStrategy) {
        setFrozenRecords(
          buildFrozenRowsForStrategy(
            history.slice(0, 50),
            selectedStrategy,
            strategies
          )
        )
      } else {
        setFrozenRecords([])
      }
    } catch (err) {
      console.error('冻结记录同步失败：', err)
      setBestFrozenStrategy(null)
    }
  }, [history, selectedStrategy, strategies])

  async function copyBestFrozenStrategy() {
    if (!bestFrozenStrategy?.strategy) return

    const item = bestFrozenStrategy
    const text = [
      `最优6尾：${item.strategy.name}`,
      `尾数：${item.strategy.tails.join(' ')}`,
      `冻结20期：${fmtPercent(item.frozen20.hitRate)}（${item.frozen20.hitCount}/${item.frozen20.testedCount}）`,
      `冻结30期：${fmtPercent(item.frozen30.hitRate)}（${item.frozen30.hitCount}/${item.frozen30.testedCount}）`,
      `冻结50期：${fmtPercent(item.frozen50.hitRate)}（${item.frozen50.hitCount}/${item.frozen50.testedCount}）`,
    ].join('｜')

    try {
      await navigator.clipboard.writeText(text)
      setBestCopied(true)
      setTimeout(() => setBestCopied(false), 1500)
    } catch {
      alert(text)
    }
  }

  async function copyTails() {
    const text = `第${data?.nextBlock || '-'}区块 37号码版 6尾参考：${prediction.tails.join(' ')}`
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      alert(text)
    }
  }

  const latest = data?.latest

  return (
    <main className="page">
      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#07111f;color:#e5edf7;font-family:Arial,'Microsoft YaHei',sans-serif}.page{min-height:100vh;padding:28px;background:radial-gradient(circle at top,#17365e 0%,#07111f 45%,#050914 100%)}.wrap{max-width:1240px;margin:0 auto}.hero{display:grid;grid-template-columns:1.2fr .8fr;gap:18px;margin-bottom:18px}.card{background:rgba(15,27,48,.92);border:1px solid rgba(148,163,184,.22);border-radius:18px;box-shadow:0 18px 40px rgba(0,0,0,.28);padding:22px;margin-bottom:18px}.card h1{font-size:34px;margin:0 0 10px}.card h2{font-size:22px;margin:0 0 14px}.muted{color:#9fb2cc;line-height:1.7}.latest-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.box{padding:14px;border-radius:14px;background:rgba(2,6,23,.34);border:1px solid rgba(148,163,184,.15)}.label{font-size:13px;color:#9fb2cc;margin-bottom:7px}.value{font-size:26px;font-weight:900}.hash{font-family:monospace;word-break:break-all;color:#bfdbfe}.tails{display:flex;gap:8px;flex-wrap:wrap}.tail{display:inline-flex;width:34px;height:34px;border-radius:11px;align-items:center;justify-content:center;background:#1e293b;border:1px solid #334155;color:#cbd5e1;font-weight:900}.tail.active{background:#22c55e;border-color:#86efac;color:#052e16}.btn{border:none;border-radius:12px;padding:12px 16px;background:linear-gradient(145deg,#fde047,#f97316);color:#111827;font-weight:900;cursor:pointer}.blue-btn{background:#38bdf8;border:none;border-radius:999px;padding:10px 16px;font-weight:900;cursor:pointer;color:#07111f}.toolbar{display:flex;gap:12px;align-items:center;margin-bottom:18px}.grid{display:grid;grid-template-columns:1.35fr .8fr;gap:18px;align-items:start}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.stat{padding:14px;border-radius:14px;background:rgba(2,6,23,.34);border:1px solid rgba(148,163,184,.15)}.stat strong{font-size:22px;color:#4ade80}table{width:100%;border-collapse:collapse}th,td{padding:12px 10px;border-bottom:1px solid rgba(148,163,184,.16);text-align:left;font-size:14px}th{color:#9fb2cc;background:rgba(2,6,23,.28)}.good{color:#4ade80;font-weight:900}.mid{color:#facc15;font-weight:900}.bad{color:#fb7185;font-weight:900}.heat-row{display:grid;grid-template-columns:42px 1fr 80px;gap:10px;align-items:center;margin:10px 0}.bar{height:10px;border-radius:999px;background:#1e293b;overflow:hidden}.bar span{display:block;height:100%;background:linear-gradient(90deg,#38bdf8,#22c55e);border-radius:999px}.records{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.record{padding:12px;border-radius:12px;background:rgba(2,6,23,.32);border:1px solid rgba(148,163,184,.12)}.record-top{display:flex;justify-content:space-between;gap:8px;margin-bottom:8px}.error{padding:16px;border-radius:14px;background:rgba(239,68,68,.14);color:#fecaca;border:1px solid rgba(248,113,113,.3);margin-bottom:18px}.input{width:100%;padding:12px;border-radius:10px;border:1px solid #334155;background:#0f172a;color:#fff;font-size:16px}.mini-grid{display:grid;grid-template-columns:repeat(10,1fr);gap:6px;margin-top:12px}.mini-cell{height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:900;color:#fff;font-size:12px}.mini-hit{background:rgba(34,197,94,.9)}.mini-miss{background:rgba(239,68,68,.9)}.mini-backfill{background:#334155}.best-frozen-panel{margin-top:14px;padding:14px;border-radius:14px;background:rgba(34,197,94,.08);border:1px solid rgba(74,222,128,.36)}.best-frozen-head{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}.best-frozen-title{font-size:18px;font-weight:900;color:#86efac}.best-frozen-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}.best-frozen-stat{padding:10px;border-radius:11px;background:rgba(2,6,23,.35);border:1px solid rgba(148,163,184,.15)}.best-frozen-stat strong{display:block;font-size:19px;color:#4ade80;margin-top:3px}.best-rank{display:inline-flex;padding:4px 9px;border-radius:999px;background:#22c55e;color:#052e16;font-weight:900;margin-left:6px}@media(max-width:950px){.best-frozen-stats{grid-template-columns:1fr}}@media(max-width:950px){.hero,.grid{display:block}.stats,.latest-grid,.records{grid-template-columns:1fr}.page{padding:16px}}
      `}</style>

      <div className="wrap">
        <section className="hero">
          <div className="card">
            <h1>哈希1分轮盘尾号统计系统｜37号码版</h1>
            <p className="muted">抓取哈希1分轮盘区块数据，按“从哈希末尾往前找两位连续数字，并反转成 00-36 以内号码”的规则解析开奖结果，再统计尾号热度、遗漏和下一期6尾参考。</p>

            <div className="best-frozen-panel">
              {bestFrozenStrategy ? (
                <>
                  <div className="best-frozen-head">
                    <div>
                      <div className="best-frozen-title">
                        当前冻结最优6尾方案
                        <span className="best-rank">
                          {bestFrozenStrategy.strategy.name}
                        </span>
                      </div>
                      <div className="muted">
                        只按冻结20、30、50期命中记录综合排名
                      </div>
                    </div>

                    <button
                      className="btn"
                      onClick={copyBestFrozenStrategy}
                    >
                      {bestCopied ? '已复制' : '复制最优方案'}
                    </button>
                  </div>

                  <div className="tails" style={{marginTop:12}}>
                    {bestFrozenStrategy.strategy.tails.map((tail) => (
                      <TailBadge key={tail} tail={tail} />
                    ))}
                  </div>

                  <div className="best-frozen-stats">
                    <div className="best-frozen-stat">
                      <div className="label">冻结近20期</div>
                      <strong>
                        {fmtPercent(bestFrozenStrategy.frozen20.hitRate)}
                      </strong>
                      <div className="muted">
                        {bestFrozenStrategy.frozen20.hitCount}/
                        {bestFrozenStrategy.frozen20.testedCount}
                        ｜连错{bestFrozenStrategy.frozen20.currentMiss}
                      </div>
                    </div>

                    <div className="best-frozen-stat">
                      <div className="label">冻结近30期</div>
                      <strong>
                        {fmtPercent(bestFrozenStrategy.frozen30.hitRate)}
                      </strong>
                      <div className="muted">
                        {bestFrozenStrategy.frozen30.hitCount}/
                        {bestFrozenStrategy.frozen30.testedCount}
                        ｜连错{bestFrozenStrategy.frozen30.currentMiss}
                      </div>
                    </div>

                    <div className="best-frozen-stat">
                      <div className="label">冻结近50期</div>
                      <strong>
                        {fmtPercent(bestFrozenStrategy.frozen50.hitRate)}
                      </strong>
                      <div className="muted">
                        {bestFrozenStrategy.frozen50.hitCount}/
                        {bestFrozenStrategy.frozen50.testedCount}
                        ｜连错{bestFrozenStrategy.frozen50.currentMiss}
                      </div>
                    </div>
                  </div>

                  <p className="muted" style={{marginBottom:0}}>
                    下一期开奖前，全部方案会按原有冻结机制保存；
                    开奖后该最优方案对应期数只追加“中/未中”，以后刷新不会改写。
                  </p>
                </>
              ) : (
                <div className="muted">
                  等待历史数据与冻结记录加载……
                </div>
              )}
            </div>

            <div className="stats">
              {WINDOWS.map((size) => (
                <div className="stat" key={size}>
                  <div className="label">推荐6尾近{size}期</div>
                  <strong>{fmtPercent(predTests[size]?.hitRate)}</strong>
                  <div className="muted">{predTests[size]?.hitCount || 0}/{predTests[size]?.testedCount || 0}｜连错{predTests[size]?.currentMiss || 0}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h2>最新开奖</h2>
            <div className="latest-grid">
              <div className="box"><div className="label">区块号</div><div className="value">{latest?.block || '-'}</div></div>
              <div className="box"><div className="label">开奖号</div><div className="value">{latest?.openCode || '-'}</div></div>
              <div className="box"><div className="label">尾号</div><div className="value">{latest?.tail ?? '-'}</div></div>
            </div>
            <p className="muted">下一开奖区块参考：{data?.nextBlock || '-'}</p>
            <p className="muted">开奖范围：{data?.openRange || '00-36'} ｜ 倒计时：{data?.countdownSeconds ?? '-'} 秒</p>
            <p className="hash">{latest?.hash || '接口暂未返回区块哈希时，会使用平台开奖结果作为备用统计。'}</p>
          </div>
        </section>

        <div className="toolbar">
          <button className="blue-btn" onClick={loadData}>{loading ? '刷新中...' : '刷新数据'}</button>
          <span className="muted">数据源：{data?.source || '-'} ｜ 更新时间：{data?.updatedAt ? new Date(data.updatedAt).toLocaleString() : '-'} ｜ 每5秒自动刷新</span>
        </div>
        {error && <div className="error">{error}</div>}

        <section className="grid">
          <div>
            <div className="card">
              <h2>下一期6尾参考</h2>
              <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap'}}>
                <div className="tails">{prediction.tails.map((tail) => <TailBadge key={tail} tail={tail} />)}</div>
                <button className="btn" onClick={copyTails}>{copied ? '已复制' : '复制6尾'}</button>
              </div>
              <p className="muted">算法：近20热度 + 近50稳定 + 近100基础 + 遗漏补位 + 趋势升温。仅作历史统计参考，不保证未来结果。</p>
            </div>

            <div className="card">
              <h2>投注盈利计算</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="box">
                  <div className="label">单尾投注金额</div>
                  <input className="input" value={betAmount} onChange={(e) => setBetAmount(e.target.value)} />
                </div>
                <div className="box">
                  <div className="label">赔率</div>
                  <input className="input" value={odds} onChange={(e) => setOdds(e.target.value)} />
                </div>
              </div>
              <p className="muted">6尾总投注：{totalBet.toFixed(2)}</p>
              <p className="muted">中奖返还：{winReturn.toFixed(2)}</p>
              <p className={profit >= 0 ? 'good' : 'bad'}>中奖净盈利：{profit.toFixed(2)}</p>
              <p className="bad">未中亏损：-{loseAmount.toFixed(2)}</p>
            </div>

            <div className="card">
              <h2>{strategies.length}套6尾方案回测</h2>
              <table>
                <thead><tr><th>方案</th><th>逻辑</th><th>6尾</th><th>20期</th><th>50期</th><th>100期</th><th>200期</th><th>当前连错</th></tr></thead>
                <tbody>
                  {strategies.map((item) => (
                    <tr key={item.id} onClick={() => setSelectedStrategyId(item.id)} style={{cursor:'pointer',background:selectedStrategyId===item.id?'rgba(34,197,94,.12)':'transparent'}}>
                      <td><strong>{item.name}</strong></td>
                      <td>{item.logic}</td>
                      <td><div className="tails">{item.tails.map((tail) => <TailBadge key={tail} tail={tail} />)}</div></td>
                      <td className={item.result20?.hitRate >= 65 ? 'good' : item.result20?.hitRate >= 55 ? 'mid' : 'bad'}>{fmtPercent(item.result20?.hitRate)}</td>
                      <td>{fmtPercent(item.result50?.hitRate)}</td>
                      <td>{fmtPercent(item.result100?.hitRate)}</td>
                      <td>{fmtPercent(item.result200?.hitRate)}</td>
                      <td>{item.result20?.currentMiss ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card">
              <h2>每个方案近20期冻结统计</h2>
              <p className="muted">有开奖前真实冻结则用真实冻结；没有冻结记录则用系统当前预测方案补建一次历史冻结，补建后永久保存，不再随方案变化改写。</p>
              <div className="records">
                {strategyFreezeStats.map((group) => (
                  <div className="record" key={group.strategy.id}>
                    <div className="record-top">
                      <strong>{group.strategy.name}｜{group.strategy.logic}</strong>
                      <span className={group.hitRate >= 70 ? 'good' : group.hitRate >= 55 ? 'mid' : 'bad'}>{fmtPercent(group.hitRate)}</span>
                    </div>
                    <div className="muted">命中 {group.hitCount}/{group.testedCount} ｜ 当前连错 {group.currentMiss}</div>
                    <div className="tails" style={{ marginTop: 8 }}>{group.strategy.tails.map((tail) => <TailBadge key={tail} tail={tail} />)}</div>
                    <div className="mini-grid">
                      {group.rows.map((row) => (
                        <div key={`${group.strategy.id}-${row.block}`} title={`区块 ${row.block}｜开 ${row.openCode}｜尾${row.tail}｜${row.hit ? '中奖' : '未中奖'}${row.backfilled ? '｜补冻结' : '｜真实冻结'}`} className={`mini-cell ${row.hit ? 'mini-hit' : 'mini-miss'}`}>
                          {row.hit ? '中' : '未'}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <h2>当前选择方案开奖记录冻结判断</h2>
              <p className="muted">当前选择：{selectedStrategy?.name || '-'}｜{selectedStrategy?.logic || '-'}。历史冻结不会因新方案变化而改写。</p>
              <div className="records">
                {frozenRecords.slice(0, 50).map((item) => (
                  <div className="record" key={`${item.strategyId}-${item.block}`} style={{borderColor:item.hit?'rgba(34,197,94,.45)':'rgba(239,68,68,.45)',background:item.hit?'rgba(34,197,94,.08)':'rgba(239,68,68,.08)'}}>
                    <div className="record-top"><strong>区块 {item.block}</strong><span className={item.hit ? 'good' : 'bad'}>{item.hit ? '中奖' : '未中奖'}</span></div>
                    <div>开 {item.openCode} ｜ 尾{item.tail}</div>
                    <div className="muted">方案：{item.strategyName}｜{item.strategyLogic}｜{item.backfilled ? '补冻结' : '真实冻结'}</div>
                    <div className="tails" style={{ marginTop: 8 }}>{item.tails.map((tail) => <TailBadge key={tail} tail={tail} active={tail === item.tail || item.tails.includes(tail)} />)}</div>
                    <div className="muted" style={{ marginTop: 8 }}>取值：{item.sourcePair ? `${item.sourcePair} → ${item.openCode}` : '-'}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <aside>
            <div className="card">
              <h2>尾号综合评分</h2>
              {prediction.scores.map((item) => (
                <div className="heat-row" key={item.tail}>
                  <TailBadge tail={item.tail} active={prediction.tails.includes(item.tail)} />
                  <div className="bar"><span style={{width:`${Math.min(100, item.score)}%`}} /></div>
                  <strong>{item.score}</strong>
                </div>
              ))}
            </div>

            <div className="card">
              <h2>近200期热度</h2>
              {[...heat200].sort((a,b)=>b.count-a.count||a.tail-b.tail).map((item) => (
                <div className="heat-row" key={item.tail}>
                  <TailBadge tail={item.tail} active={prediction.tails.includes(item.tail)} />
                  <div className="bar"><span style={{width:`${Math.min(100,item.rate*4)}%`}} /></div>
                  <strong>{item.count}次</strong>
                </div>
              ))}
            </div>

            <div className="card">
              <h2>近200期遗漏</h2>
              {[...heat200].sort((a,b)=>b.omit-a.omit||a.tail-b.tail).map((item) => (
                <div className="heat-row" key={item.tail}>
                  <TailBadge tail={item.tail} active={prediction.tails.includes(item.tail)} />
                  <div className="bar"><span style={{width:`${Math.min(100,item.omit*8)}%`}} /></div>
                  <strong>{item.omit}期</strong>
                </div>
              ))}
            </div>
          </aside>
        </section>
      </div>
    </main>
  )
}
