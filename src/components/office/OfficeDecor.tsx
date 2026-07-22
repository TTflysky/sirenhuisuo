/**
 * 办公室静态装饰：茶水台、跑步机、绿植、卫生间
 * 放在 .office-floor 内绝对定位，用 billboard 反向站立
 */
export default function OfficeDecor() {
  return (
    <>
      {/* 茶水台 - 左上角区域 */}
      <div className="office-decor" style={{ gridArea: '1 / 1 / 2 / 2', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, paddingTop: 8 }}>
        <div style={{ width: 80, height: 36, background: '#f0f1f5', borderRadius: 6, boxShadow: '0 2px 6px rgba(31,41,55,0.06)', position: 'relative' }}>
          {/* 咖啡杯 */}
          <div style={{ position: 'absolute', top: -10, left: 4, fontSize: 12 }}>☕</div>
          <div style={{ position: 'absolute', top: -10, left: 20, fontSize: 12 }}>☕</div>
          <div style={{ position: 'absolute', top: -10, left: 36, fontSize: 12 }}>☕</div>
          {/* 咖啡机 */}
          <div style={{ position: 'absolute', top: -18, right: 2, width: 20, height: 24, background: '#d1d5db', borderRadius: 3 }} />
        </div>
      </div>

      {/* 跑步机 - 左中 */}
      <div className="office-decor" style={{ gridArea: '2 / 1 / 3 / 2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 70, height: 32, background: '#e8ecf4', borderRadius: 6, position: 'relative', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            background: 'repeating-linear-gradient(90deg, transparent, transparent 8px, #cbd5e1 8px, #cbd5e1 10px)',
            opacity: 0.4
          }} />
          {/* 扶手 */}
          <div style={{ position: 'absolute', top: -8, left: 4, right: 4, height: 10, border: '2px solid #94a3b8', borderBottom: 'none', borderRadius: '4px 4px 0 0' }} />
        </div>
      </div>

      {/* 绿植 - 右下 */}
      <div className="office-decor" style={{ gridArea: '3 / 4 / 4 / 5', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 4 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {/* 树冠 */}
          <div style={{ width: 28, height: 28, background: '#86efac', borderRadius: '50%' }} />
          <div style={{ width: 22, height: 22, background: '#4ade80', borderRadius: '50%', marginTop: -10 }} />
          {/* 花盆 */}
          <div style={{ width: 16, height: 14, background: '#e2e8f0', borderRadius: '0 0 4px 4px', marginTop: -4 }} />
        </div>
      </div>

      {/* 卫生间标识 - 左下 */}
      <div className="office-decor billboard" style={{ gridArea: '3 / 1 / 4 / 2', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 16 }}>
        <div style={{
          width: 40, height: 52, background: '#f1f3f7', borderRadius: '6px 6px 2px 2px',
          border: '1.5px solid #e2e6ef', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, color: '#94a3b8'
        }}>
          🚻
        </div>
      </div>
    </>
  );
}
