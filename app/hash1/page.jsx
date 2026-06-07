'use client'

import { useEffect, useMemo, useState } from 'react'

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

function getFreezeKey(block) {
  return `hash1-main-freeze-${block}`
}

function getStrategyFreezeKey(strategyId, block) {
  return `hash1-strategy-freeze-${strategyId}-${block}`
}

export default function Hash1Page() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [betAmount, setBetAmount] = useState(100)
  const [odds, setOdds] = useState(9.7)
  const [selectedStrategyId, setSelectedStrategyId] = useState('s1')
  const [frozenRecords, setFrozenRecords] = useState([])
  const [strategyFreezeStats, setStrategyFreezeStats] = useState([])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/hash1', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.message || '接口请求失败')
      setData(json)
    } catch (err) {
      setError(err.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const history = data?.history || []

  const prediction = useMemo(() => {
    const local = predictSixTails(history)
    return {
      tails: Array.isArray(data?.predictedTails) && data.predictedTails.length ? data.predictedTails : local.tails,
      scores: local.scores,
    }
  }, [data?.predictedTails, history])

  const strategies = useMemo(() => {
    return Array.isArray(data?.optimizedStrategies) && data.optimizedStrategies.length
      ? data.optimizedStrategies
      : buildTailStrategies(history)
  }, [data?.optimizedStrategies, history])

  const predTests = useMemo(() => {
    if (data?.predictStats) return data.predictStats
    const tails = prediction.tails
    return Object.fromEntries(WINDOWS.map((size) => [size, testTails(history, tails, size)]))
  }, [data?.predictStats, history, prediction.tails])

  const heat200 = useMemo(() => buildTailHeat(history, 200), [history])
  const latest = data?.latest

  const selectedStrategy = strategies.find((item) => item.id === selectedStrategyId) || strategies[0]
  const amountNumber = Number(betAmount || 0)
  const oddsNumber = Number(odds || 0)
  const totalBet = amountNumber * 6
  const winReturn = amountNumber * oddsNumber
  const profit = winReturn - totalBet
  const loseAmount = totalBet

  function readFreeze(block) {
    if (typeof window === 'undefined') return null
    try {
      const raw = window.localStorage.getItem(getFreezeKey(block))
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }

  function writeFreeze(item, strategy) {
    if (typeof window === 'undefined') return null
    if (!item?.block || !strategy?.tails?.length) return null

    const old = readFreeze(item.block)
    if (old) return old

    const hit = strategy.tails.includes(Number(item.tail))
    const record = {
      block: item.block,
      openCode: item.openCode,
      tail: item.tail,
      hash: item.hash,
      sourcePair: item.sourcePair,
      openTime: item.openTime,
      strategyId: strategy.id,
      strategyName: strategy.name,
      strategyLogic: strategy.logic,
      tails: strategy.tails,
      hit,
      frozenAt: Date.now(),
    }

    window.localStorage.setItem(getFreezeKey(item.block), JSON.stringify(record))
    return record
  }

  function readStrategyFreeze(strategyId, block) {
    if (typeof window === 'undefined') return null
    try {
      const raw = window.localStorage.getItem(getStrategyFreezeKey(strategyId, block))
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }

  function writeStrategyFreeze(item, strategy) {
    if (typeof window === 'undefined') return null
    const old = readStrategyFreeze(strategy.id, item.block)
    if (old) return old

    const hit = strategy.tails.includes(Number(item.tail))
    const record = {
      block: item.block,
      openCode: item.openCode,
      tail: item.tail,
      hash: item.hash,
      sourcePair: item.sourcePair,
      openTime: item.openTime,
      strategyId: strategy.id,
      strategyName: strategy.name,
      strategyLogic: strategy.logic,
      tails: strategy.tails,
      hit,
      frozenAt: Date.now(),
    }

    window.localStorage.setItem(getStrategyFreezeKey(strategy.id, item.block), JSON.stringify(record))
    return record
  }

  function buildStrategyFreezeStats(historyRows, strategyRows) {
    return strategyRows.map((strategy) => {
      const rows = historyRows.slice(0, 20).map((item) => writeStrategyFreeze(item, strategy)).filter(Boolean)
      const hitCount = rows.filter((item) => item.hit).length
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

  useEffect(() => {
    if (!history.length || !selectedStrategy) return
    const records = history.slice(0, 50).map((item) => readFreeze(item.block) || writeFreeze(item, selectedStrategy))
    setFrozenRecords(records.filter(Boolean))
  }, [history, selectedStrategy])

  useEffect(() => {
    if (!history.length || !strategies.length) return
    setStrategyFreezeStats(buildStrategyFreezeStats(history, strategies))
  }, [history, strategies])

  async function copyTails() {
    const text = `第${data?.nextBlock || '-'}区块 6尾参考：${prediction.tails.join(' ')}`
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      alert(text)
    }
  }

  return (
    <main className="page">
      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#07111f;color:#e5edf7;font-family:Arial,'Microsoft YaHei',sans-serif}.page{min-height:100vh;padding:28px;background:radial-gradient(circle at top,#17365e 0%,#07111f 45%,#050914 100%)}.wrap{max-width:1240px;margin:0 auto}.hero{display:grid;grid-template-columns:1.2fr .8fr;gap:18px;margin-bottom:18px}.card{background:rgba(15,27,48,.92);border:1px solid rgba(148,163,184,.22);border-radius:18px;box-shadow:0 18px 40px rgba(0,0,0,.28);padding:22px;margin-bottom:18px}.card h1{font-size:34px;margin:0 0 10px}.card h2{font-size:22px;margin:0 0 14px}.muted{color:#9fb2cc;line-height:1.7}.latest-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.box{padding:14px;border-radius:14px;background:rgba(2,6,23,.34);border:1px solid rgba(148,163,184,.15)}.label{font-size:13px;color:#9fb2cc;margin-bottom:7px}.value{font-size:26px;font-weight:900}.hash{font-family:monospace;word-break:break-all;color:#bfdbfe}.tails{display:flex;gap:8px;flex-wrap:wrap}.tail{display:inline-flex;width:34px;height:34px;border-radius:11px;align-items:center;justify-content:center;background:#1e293b;border:1px solid #334155;color:#cbd5e1;font-weight:900}.tail.active{background:#22c55e;border-color:#86efac;color:#052e16}.btn{border:none;border-radius:12px;padding:12px 16px;background:linear-gradient(145deg,#fde047,#f97316);color:#111827;font-weight:900;cursor:pointer}.blue-btn{background:#38bdf8;border:none;border-radius:999px;padding:10px 16px;font-weight:900;cursor:pointer;color:#07111f}.toolbar{display:flex;gap:12px;align-items:center;margin-bottom:18px}.grid{display:grid;grid-template-columns:1.35fr .8fr;gap:18px;align-items:start}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.stat{padding:14px;border-radius:14px;background:rgba(2,6,23,.34);border:1px solid rgba(148,163,184,.15)}.stat strong{font-size:22px;color:#4ade80}table{width:100%;border-collapse:collapse}th,td{padding:12px 10px;border-bottom:1px solid rgba(148,163,184,.16);text-align:left;font-size:14px}th{color:#9fb2cc;background:rgba(2,6,23,.28)}tr.clickable{cursor:pointer}tr.clickable:hover{background:rgba(34,197,94,.08)}.selected-row{background:rgba(34,197,94,.14)}.good{color:#4ade80;font-weight:900}.mid{color:#facc15;font-weight:900}.bad{color:#fb7185;font-weight:900}.heat-row{display:grid;grid-template-columns:42px 1fr 80px;gap:10px;align-items:center;margin:10px 0}.bar{height:10px;border-radius:999px;background:#1e293b;overflow:hidden}.bar span{display:block;height:100%;background:linear-gradient(90deg,#38bdf8,#22c55e);border-radius:999px}.records{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.record{padding:12px;border-radius:12px;background:rgba(2,6,23,.32);border:1px solid rgba(148,163,184,.12)}.record-top{display:flex;justify-content:space-between;gap:8px;margin-bottom:8px}.error{padding:16px;border-radius:14px;background:rgba(239,68,68,.14);color:#fecaca;border:1px solid rgba(248,113,113,.3)}.input{width:100%;padding:12px;border-radius:10px;border:1px solid #334155;background:#0f172a;color:#fff;font-size:16px}.freeze-grid{display:grid;grid-template-columns:repeat(10,1fr);gap:6px;margin-top:12px}.freeze-cell{height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:900;color:#fff;font-size:12px}.freeze-hit{background:rgba(34,197,94,.9)}.freeze-miss{background:rgba(239,68,68,.9)}@media(max-width:950px){.hero,.grid{display:block}.stats,.latest-grid,.records{grid-template-columns:1fr}.page{padding:16px}}
      `}</style>

      <div className="wrap">
        <section className="hero">
          <div className="card">
            <h1>哈希1分轮盘尾号统计系统</h1>
            <p className="muted">自动优化10套6尾方案，支持投注金额、赔率、盈利计算，并冻结每期开奖中奖/未中奖结果。</p>
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
            <p className="muted">倒计时：{data?.countdownSeconds ?? '-'} 秒</p>
            <p className="hash">{latest?.hash || '等待数据...'}</p>
          </div>
        </section>

        <div className="toolbar">
          <button className="blue-btn" onClick={loadData}>{loading ? '刷新中...' : '刷新数据'}</button>
          <span className="muted">数据源：{data?.source || '-'} ｜ 更新时间：{data?.updatedAt ? new Date(data.updatedAt).toLocaleString() : '-'}</span>
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
              <p className="muted">当前默认采用综合胜率最高的方案。仅作历史统计参考，不保证未来结果。</p>
            </div>

            <div className="card">
              <h2>投注盈利计算</h2>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div className="box"><div className="label">单尾投注金额</div><input className="input" value={betAmount} onChange={(e)=>setBetAmount(e.target.value)} /></div>
                <div className="box"><div className="label">赔率</div><input className="input" value={odds} onChange={(e)=>setOdds(e.target.value)} /></div>
              </div>
              <p className="muted">当前选择：{selectedStrategy?.name || '-'}｜{selectedStrategy?.logic || '-'}</p>
              <p className="muted">6尾总投注：{totalBet.toFixed(2)}</p>
              <p className="muted">中奖返还：{winReturn.toFixed(2)}</p>
              <p className={profit >= 0 ? 'good' : 'bad'}>中奖净盈利：{profit.toFixed(2)}</p>
              <p className="bad">未中亏损：-{loseAmount.toFixed(2)}</p>
            </div>

            <div className="card">
              <h2>10套6尾方案回测</h2>
              <table>
                <thead><tr><th>方案</th><th>逻辑</th><th>6尾</th><th>20期</th><th>50期</th><th>100期</th><th>200期</th><th>当前连错</th></tr></thead>
                <tbody>
                  {strategies.map((item) => (
                    <tr key={item.id} className={selectedStrategyId === item.id ? 'clickable selected-row' : 'clickable'} onClick={() => setSelectedStrategyId(item.id)}>
                      <td><strong>{item.name}</strong></td>
                      <td>{item.logic}</td>
                      <td><div className="tails">{item.tails.map((tail) => <TailBadge key={tail} tail={tail} />)}</div></td>
                      <td className={item.result20.hitRate >= 65 ? 'good' : item.result20.hitRate >= 55 ? 'mid' : 'bad'}>{fmtPercent(item.result20.hitRate)}</td>
                      <td>{fmtPercent(item.result50.hitRate)}</td>
                      <td>{fmtPercent(item.result100.hitRate)}</td>
                      <td>{fmtPercent(item.result200?.hitRate)}</td>
                      <td>{item.result20.currentMiss}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card">
              <h2>每个方案近20期冻结统计</h2>
              <p className="muted">每个方案都会独立冻结近20期中奖/未中奖记录，后续方案重新优化不会改写已冻结结果。</p>
              <div className="records">
                {strategyFreezeStats.map((group) => (
                  <div className="record" key={group.strategy.id}>
                    <div className="record-top">
                      <strong>{group.strategy.name}｜{group.strategy.logic}</strong>
                      <span className={group.hitRate >= 70 ? 'good' : group.hitRate >= 55 ? 'mid' : 'bad'}>{fmtPercent(group.hitRate)}</span>
                    </div>
                    <div className="muted">命中 {group.hitCount}/{group.testedCount} ｜ 当前连错 {group.currentMiss}</div>
                    <div className="tails" style={{marginTop:8}}>{group.strategy.tails.map((tail) => <TailBadge key={tail} tail={tail} />)}</div>
                    <div className="freeze-grid">
                      {group.rows.map((row) => (
                        <div key={row.block} className={row.hit ? 'freeze-cell freeze-hit' : 'freeze-cell freeze-miss'} title={`区块 ${row.block}｜开 ${row.openCode}｜尾${row.tail}｜${row.hit ? '中奖' : '未中奖'}`}>
                          {row.hit ? '中' : '未'}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <h2>近期开奖冻结记录</h2>
              <p className="muted">按当前选择方案冻结开奖记录。每期开奖第一次记录后，后续方案变化不会改写历史中奖/未中奖结果。</p>
              <div className="records">
                {frozenRecords.slice(0, 50).map((item) => (
                  <div className="record" key={item.block} style={{borderColor:item.hit?'rgba(34,197,94,.45)':'rgba(239,68,68,.45)',background:item.hit?'rgba(34,197,94,.08)':'rgba(239,68,68,.08)'}}>
                    <div className="record-top"><strong>区块 {item.block}</strong><span className={item.hit ? 'good' : 'bad'}>{item.hit ? '中奖' : '未中奖'}</span></div>
                    <div>开 {item.openCode} ｜ 尾{item.tail}</div>
                    <div className="muted">方案：{item.strategyName}｜{item.strategyLogic}</div>
                    <div className="tails" style={{marginTop:8}}>{item.tails.map((tail) => <TailBadge key={tail} tail={tail} active />)}</div>
                    <div className="muted" style={{marginTop:8}}>取值：{item.sourcePair ? `${item.sourcePair} → ${item.openCode}` : '-'} ｜ 冻结记录</div>
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
