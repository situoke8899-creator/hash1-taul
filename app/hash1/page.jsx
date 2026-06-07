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
  const rows = Array.from({ length: 10 }, (_, tail) => ({ tail, count: 0, omit: source.length, lastIndex: -1, rate: 0 }))
  source.forEach((item, index) => {
    const tail = Number(item.tail)
    if (!Number.isInteger(tail)) return
    rows[tail].count += 1
    if (rows[tail].lastIndex === -1) rows[tail].lastIndex = index
  })
  return rows.map((row) => ({ ...row, omit: row.lastIndex === -1 ? source.length : row.lastIndex, rate: source.length ? (row.count / source.length) * 100 : 0 }))
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
    return { tail, score: Number(score.toFixed(2)), count20: h20.count, count50: h50.count, count100: h100.count, count200: h200.count, omit: h200.omit, trend: Number(trend.toFixed(2)) }
  })
  const selected = [...scores].sort((a, b) => b.score - a.score || b.count20 - a.count20 || b.omit - a.omit || a.tail - b.tail).slice(0, 6).map((item) => item.tail).sort((a, b) => a - b)
  return { tails: selected, scores: scores.sort((a, b) => b.score - a.score) }
}

function testTails(history, tails, size) {
  const source = history.slice(0, size)
  const set = new Set(tails)
  const rows = source.map((item) => ({ ...item, hit: set.has(Number(item.tail)) }))
  const results = rows.map((item) => item.hit)
  const testedCount = rows.length
  const hitCount = rows.filter((item) => item.hit).length
  return { testedCount, hitCount, missCount: testedCount - hitCount, hitRate: testedCount ? (hitCount / testedCount) * 100 : 0, coverageRate: tails.length * 10, maxMiss: calcMaxMiss(results), currentMiss: calcCurrentMiss(results), rows }
}

function buildTailStrategies(history) {
  const heat20 = buildTailHeat(history, 20)
  const hot20 = [...heat20].sort((a, b) => b.count - a.count || a.tail - b.tail).map((i) => i.tail)
  const tails = hot20.slice(0, 6).sort((a, b) => a - b)
  return [{ id: 's1', name: '方案1', logic: '20期热尾', tails, result20: testTails(history, tails, 20), result50: testTails(history, tails, 50), result100: testTails(history, tails, 100), result200: testTails(history, tails, 200) }]
}

function TailBadge({ tail, active = true }) {
  return <span className={active ? 'tail active' : 'tail'}>{tail}</span>
}

function resultClass(rate) {
  if (rate >= 70) return 'good'
  if (rate >= 55) return 'mid'
  return 'bad'
}

function getFreezeKey(strategyId, block) {
  return `hash1-freeze-v3-${strategyId}-${block}`
}

function readFreeze(strategyId, block) {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(getFreezeKey(strategyId, block))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeFreeze(item, strategy) {
  if (typeof window === 'undefined') return null
  if (!item?.block || !strategy?.id || !strategy?.tails?.length) return null
  const old = readFreeze(strategy.id, item.block)
  if (old) return old
  const hit = strategy.tails.includes(Number(item.tail))
  const record = { block: item.block, openCode: item.openCode, tail: item.tail, hash: item.hash, sourcePair: item.sourcePair, openTime: item.openTime, strategyId: strategy.id, strategyName: strategy.name, strategyLogic: strategy.logic, tails: strategy.tails, hit, frozenAt: Date.now() }
  window.localStorage.setItem(getFreezeKey(strategy.id, item.block), JSON.stringify(record))
  return record
}

function buildStrategyFreezeStats(history, strategies) {
  if (typeof window === 'undefined') return []
  return strategies.map((strategy) => {
    const rows = history.slice(0, 20).map((item) => readFreeze(strategy.id, item.block) || writeFreeze(item, strategy)).filter(Boolean)
    const hitCount = rows.filter((item) => item.hit).length
    const testedCount = rows.length
    let currentMiss = 0
    for (const row of rows) {
      if (row.hit) break
      currentMiss += 1
    }
    return { strategy, rows, hitCount, testedCount, hitRate: testedCount ? (hitCount / testedCount) * 100 : 0, currentMiss }
  })
}

export default function Hash1Page() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [betAmount, setBetAmount] = useState(100)
  const [odds, setOdds] = useState(9.7)
  const [selectedStrategyId, setSelectedStrategyId] = useState('s11')
  const [strategyFreezeStats, setStrategyFreezeStats] = useState([])
  const [selectedFrozenRecords, setSelectedFrozenRecords] = useState([])

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
  const strategies = useMemo(() => Array.isArray(data?.optimizedStrategies) && data.optimizedStrategies.length ? data.optimizedStrategies : buildTailStrategies(history), [data?.optimizedStrategies, history])
  const prediction = useMemo(() => {
    const local = predictSixTails(history)
    return { tails: Array.isArray(data?.predictedTails) && data.predictedTails.length ? data.predictedTails : local.tails, scores: local.scores }
  }, [data?.predictedTails, history])
  const predTests = useMemo(() => data?.predictStats || Object.fromEntries(WINDOWS.map((size) => [size, testTails(history, prediction.tails, size)])), [data?.predictStats, history, prediction.tails])
  const heat200 = useMemo(() => buildTailHeat(history, 200), [history])
  const selectedStrategy = strategies.find((item) => item.id === selectedStrategyId) || strategies[strategies.length - 1] || strategies[0]

  useEffect(() => {
    if (!strategies.length) return
    if (!strategies.some((item) => item.id === selectedStrategyId)) setSelectedStrategyId(strategies[strategies.length - 1]?.id || strategies[0]?.id || 's1')
  }, [strategies, selectedStrategyId])

  useEffect(() => {
    if (!history.length || !strategies.length) return
    const stats = buildStrategyFreezeStats(history, strategies)
    setStrategyFreezeStats(stats)
    const selected = strategies.find((item) => item.id === selectedStrategyId) || strategies[0]
    const records = history.slice(0, 50).map((item) => readFreeze(selected.id, item.block) || writeFreeze(item, selected)).filter(Boolean)
    setSelectedFrozenRecords(records)
  }, [history, strategies, selectedStrategyId])

  const latest = data?.latest
  const amountNumber = Number(betAmount || 0)
  const oddsNumber = Number(odds || 0)
  const totalBet = amountNumber * 6
  const winReturn = amountNumber * oddsNumber
  const profit = winReturn - totalBet
  const loseAmount = totalBet

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
        *{box-sizing:border-box}body{margin:0;background:#07111f;color:#e5edf7;font-family:Arial,'Microsoft YaHei',sans-serif}.page{min-height:100vh;padding:28px;background:radial-gradient(circle at top,#17365e 0%,#07111f 45%,#050914 100%)}.wrap{max-width:1240px;margin:0 auto}.hero{display:grid;grid-template-columns:1.2fr .8fr;gap:18px;margin-bottom:18px}.card{background:rgba(15,27,48,.92);border:1px solid rgba(148,163,184,.22);border-radius:18px;box-shadow:0 18px 40px rgba(0,0,0,.28);padding:22px;margin-bottom:18px}.card h1{font-size:34px;margin:0 0 10px}.card h2{font-size:22px;margin:0 0 14px}.muted{color:#9fb2cc;line-height:1.7}.latest-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.box{padding:14px;border-radius:14px;background:rgba(2,6,23,.34);border:1px solid rgba(148,163,184,.15)}.label{font-size:13px;color:#9fb2cc;margin-bottom:7px}.value{font-size:26px;font-weight:900}.hash{font-family:monospace;word-break:break-all;color:#bfdbfe}.tails{display:flex;gap:8px;flex-wrap:wrap}.tail{display:inline-flex;width:34px;height:34px;border-radius:11px;align-items:center;justify-content:center;background:#1e293b;border:1px solid #334155;color:#cbd5e1;font-weight:900}.tail.active{background:#22c55e;border-color:#86efac;color:#052e16}.btn{border:none;border-radius:12px;padding:12px 16px;background:linear-gradient(145deg,#fde047,#f97316);color:#111827;font-weight:900;cursor:pointer}.blue-btn{background:#38bdf8;border:none;border-radius:999px;padding:10px 16px;font-weight:900;cursor:pointer;color:#07111f}.toolbar{display:flex;gap:12px;align-items:center;margin-bottom:18px}.grid{display:grid;grid-template-columns:1.35fr .8fr;gap:18px;align-items:start}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.stat{padding:14px;border-radius:14px;background:rgba(2,6,23,.34);border:1px solid rgba(148,163,184,.15)}.stat strong{font-size:22px;color:#4ade80}table{width:100%;border-collapse:collapse}th,td{padding:12px 8px;border-bottom:1px solid rgba(148,163,184,.16);text-align:left;font-size:13px}th{color:#9fb2cc;background:rgba(2,6,23,.28)}.good{color:#4ade80;font-weight:900}.mid{color:#facc15;font-weight:900}.bad{color:#fb7185;font-weight:900}.heat-row{display:grid;grid-template-columns:42px 1fr 80px;gap:10px;align-items:center;margin:10px 0}.bar{height:10px;border-radius:999px;background:#1e293b;overflow:hidden}.bar span{display:block;height:100%;background:linear-gradient(90deg,#38bdf8,#22c55e);border-radius:999px}.records{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.record{padding:12px;border-radius:12px;background:rgba(2,6,23,.32);border:1px solid rgba(148,163,184,.12)}.record-top{display:flex;justify-content:space-between;gap:8px;margin-bottom:8px}.error{padding:16px;border-radius:14px;background:rgba(239,68,68,.14);color:#fecaca;border:1px solid rgba(248,113,113,.3);margin-bottom:18px}.input{width:100%;padding:12px;border-radius:10px;border:1px solid #334155;background:#0f172a;color:#fff;font-size:16px}.heat-grid{display:grid;grid-template-columns:repeat(10,1fr);gap:6px;margin-top:12px}.heat-cell{height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:900;color:#fff;font-size:12px}@media(max-width:950px){.hero,.grid{display:block}.stats,.latest-grid,.records{grid-template-columns:1fr}.page{padding:16px}table{font-size:12px}.heat-grid{grid-template-columns:repeat(5,1fr)}}
      `}</style>
      <div className="wrap">
        <section className="hero">
          <div className="card">
            <h1>哈希1分轮盘尾号统计系统</h1>
            <p className="muted">自动优化11套6尾方案，方案11为前10档出现频率最高的综合尾数。历史冻结记录保存在浏览器本地，不会因为后续方案变化而改写。</p>
            <div className="stats">{WINDOWS.map((size) => <div className="stat" key={size}><div className="label">推荐6尾近{size}期</div><strong>{fmtPercent(predTests[size]?.hitRate)}</strong><div className="muted">{predTests[size]?.hitCount || 0}/{predTests[size]?.testedCount || 0}｜连错{predTests[size]?.currentMiss || 0}</div></div>)}</div>
          </div>
          <div className="card"><h2>最新开奖</h2><div className="latest-grid"><div className="box"><div className="label">区块号</div><div className="value">{latest?.block || '-'}</div></div><div className="box"><div className="label">开奖号</div><div className="value">{latest?.openCode || '-'}</div></div><div className="box"><div className="label">尾号</div><div className="value">{latest?.tail ?? '-'}</div></div></div><p className="muted">下一期开奖区块参考：{data?.nextBlock || '-'}</p><p className="hash">{latest?.hash || '接口暂未返回区块哈希。'}</p></div>
        </section>
        <div className="toolbar"><button className="blue-btn" onClick={loadData}>{loading ? '刷新中...' : '刷新数据'}</button><span className="muted">数据源：{data?.source || '-'} ｜ 更新时间：{data?.updatedAt ? new Date(data.updatedAt).toLocaleString() : '-'}</span></div>
        {error && <div className="error">{error}</div>}
        <section className="grid"><div>
          <div className="card"><h2>下一期6尾参考</h2><div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap'}}><div className="tails">{prediction.tails.map((tail) => <TailBadge key={tail} tail={tail} />)}</div><button className="btn" onClick={copyTails}>{copied ? '已复制' : '复制6尾'}</button></div><p className="muted">默认采用方案11：前10档出现最多的综合尾数。仅作历史统计参考，不保证未来结果。</p></div>
          <div className="card"><h2>投注盈利计算</h2><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}><div className="box"><div className="label">单尾投注金额</div><input className="input" value={betAmount} onChange={(e)=>setBetAmount(e.target.value)} /></div><div className="box"><div className="label">赔率</div><input className="input" value={odds} onChange={(e)=>setOdds(e.target.value)} /></div></div><p className="muted">当前选择：{selectedStrategy?.name || '-'}｜{selectedStrategy?.logic || '-'}</p><p className="muted">6尾总投注：{totalBet.toFixed(2)}</p><p className="muted">中奖返还：{winReturn.toFixed(2)}</p><p className={profit >= 0 ? 'good' : 'bad'}>中奖净盈利：{profit.toFixed(2)}</p><p className="bad">未中亏损：-{loseAmount.toFixed(2)}</p></div>
          <div className="card"><h2>11套6尾方案回测</h2><table><thead><tr><th>方案</th><th>逻辑</th><th>6尾</th><th>20期</th><th>50期</th><th>100期</th><th>200期</th><th>当前连错</th></tr></thead><tbody>{strategies.map((item) => <tr key={item.id} onClick={() => setSelectedStrategyId(item.id)} style={{cursor:'pointer',background:selectedStrategyId===item.id?'rgba(34,197,94,.12)':'transparent'}}><td><strong>{item.name}</strong></td><td>{item.logic}</td><td><div className="tails">{item.tails.map((tail)=><TailBadge key={tail} tail={tail}/>)}</div></td><td className={resultClass(item.result20?.hitRate)}>{fmtPercent(item.result20?.hitRate)}</td><td>{fmtPercent(item.result50?.hitRate)}</td><td>{fmtPercent(item.result100?.hitRate)}</td><td>{fmtPercent(item.result200?.hitRate)}</td><td>{item.result20?.currentMiss ?? 0}</td></tr>)}</tbody></table></div>
          <div className="card"><h2>每个方案近20期冻结统计</h2><p className="muted">每个方案都会单独冻结近20期开奖中/未中结果，后续方案尾数变化不会改写已冻结记录。</p><div className="records">{strategyFreezeStats.map((group) => <div className="record" key={group.strategy.id}><div className="record-top"><strong>{group.strategy.name}｜{group.strategy.logic}</strong><span className={resultClass(group.hitRate)}>{fmtPercent(group.hitRate)}</span></div><div className="muted">命中 {group.hitCount}/{group.testedCount} ｜ 当前连错 {group.currentMiss}</div><div className="tails" style={{marginTop:8}}>{group.strategy.tails.map((tail)=><TailBadge key={tail} tail={tail}/>)}</div><div className="heat-grid">{group.rows.map((row)=><div key={row.block} className="heat-cell" title={`区块 ${row.block}｜开 ${row.openCode}｜尾${row.tail}｜${row.hit?'中奖':'未中奖'}`} style={{background:row.hit?'rgba(34,197,94,.9)':'rgba(239,68,68,.9)'}}>{row.hit?'中':'未'}</div>)}</div></div>)}</div></div>
          <div className="card"><h2>当前选择方案冻结开奖记录</h2><p className="muted">当前选择：{selectedStrategy?.name || '-'}｜{selectedStrategy?.logic || '-'}</p><div className="records">{selectedFrozenRecords.slice(0,50).map((item)=><div className="record" key={`${item.strategyId}-${item.block}`} style={{borderColor:item.hit?'rgba(34,197,94,.45)':'rgba(239,68,68,.45)',background:item.hit?'rgba(34,197,94,.08)':'rgba(239,68,68,.08)'}}><div className="record-top"><strong>区块 {item.block}</strong><span className={item.hit?'good':'bad'}>{item.hit?'中奖':'未中奖'}</span></div><div>开 {item.openCode} ｜ 尾{item.tail}</div><div className="muted">方案：{item.strategyName}｜{item.strategyLogic}</div><div className="tails" style={{marginTop:8}}>{item.tails.map((tail)=><TailBadge key={tail} tail={tail} active={item.hit && tail===item.tail}/>)}</div><div className="muted" style={{marginTop:8}}>取值：{item.sourcePair ? `${item.sourcePair} → ${item.openCode}` : '-'} ｜ 冻结记录</div></div>)}</div></div>
        </div><aside><div className="card"><h2>尾号综合评分</h2>{prediction.scores.map((item)=><div className="heat-row" key={item.tail}><TailBadge tail={item.tail} active={prediction.tails.includes(item.tail)}/><div className="bar"><span style={{width:`${Math.min(100,item.score)}%`}}/></div><strong>{item.score}</strong></div>)}</div><div className="card"><h2>近200期热度</h2>{[...heat200].sort((a,b)=>b.count-a.count||a.tail-b.tail).map((item)=><div className="heat-row" key={item.tail}><TailBadge tail={item.tail} active={prediction.tails.includes(item.tail)}/><div className="bar"><span style={{width:`${Math.min(100,item.rate*4)}%`}}/></div><strong>{item.count}次</strong></div>)}</div><div className="card"><h2>近200期遗漏</h2>{[...heat200].sort((a,b)=>b.omit-a.omit||a.tail-b.tail).map((item)=><div className="heat-row" key={item.tail}><TailBadge tail={item.tail} active={prediction.tails.includes(item.tail)}/><div className="bar"><span style={{width:`${Math.min(100,item.omit*8)}%`}}/></div><strong>{item.omit}期</strong></div>)}</div></aside></section>
      </div>
    </main>
  )
}
