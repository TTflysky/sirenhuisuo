import { useEffect, useMemo, useRef, useState } from 'react';
import { AppstoreOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import type { Employee } from '../../types';
import { getVisibleOfficeStationCount, repairEmployeeStations } from '../../data/officeStations';
import { EMPLOYEE_CATEGORIES, employeeCategoryId, type EmployeeCategoryId } from '../../data/employeeProfiles';
import Workstation from './Workstation';

interface Props {
  employees: Employee[];
  isWorking: (emp: Employee) => boolean;
  onStationClick: (emp: Employee) => void;
  onStationEdit: (emp: Employee) => void;
}

/**
 * 正俯视办公室：4×3 工位网格平铺，无 3D 斜视。
 * 每个工位一块桌面，员工形象清晰可见。
 */
export default function OfficeView({ employees, isWorking, onStationClick, onStationEdit }: Props) {
  const [category, setCategory] = useState<'all' | EmployeeCategoryId>('all');
  const categoryScrollRef = useRef<HTMLDivElement>(null);
  const [categoryScrollState, setCategoryScrollState] = useState({ canBack: false, canForward: false });
  // Keep old data with wrapped station indices visible before persistence migration finishes.
  const repairedEmployees = useMemo(() => repairEmployeeStations(employees).employees, [employees]);
  const categoryCounts = useMemo(() => {
    const counts = new Map<EmployeeCategoryId, number>();
    repairedEmployees.forEach((employee) => counts.set(employeeCategoryId(employee), (counts.get(employeeCategoryId(employee)) ?? 0) + 1));
    return counts;
  }, [repairedEmployees]);
  const visibleEmployees = useMemo(() => category === 'all'
    ? repairedEmployees
    : repairedEmployees.filter((employee) => employeeCategoryId(employee) === category), [category, repairedEmployees]);
  const stationMap = new Map<number, Employee>();
  for (const emp of visibleEmployees) {
    if (emp.stationIndex >= 0) {
      stationMap.set(emp.stationIndex, emp);
    }
  }

  const stations = [];
  const stationCount = category === 'all' ? getVisibleOfficeStationCount(repairedEmployees) : visibleEmployees.length;
  const onlineCount = employees.filter((employee) => employee.isOnline).length;
  const workingCount = employees.filter((employee) => employee.isOnline && (employee.isWorking || isWorking(employee))).length;

  const syncCategoryScrollState = () => {
    const node = categoryScrollRef.current;
    if (!node) return;
    setCategoryScrollState({
      canBack: node.scrollLeft > 1,
      canForward: node.scrollLeft + node.clientWidth < node.scrollWidth - 1,
    });
  };

  useEffect(() => {
    const node = categoryScrollRef.current;
    if (!node) return;
    syncCategoryScrollState();
    const resizeObserver = new ResizeObserver(syncCategoryScrollState);
    resizeObserver.observe(node);
    return () => resizeObserver.disconnect();
  }, [categoryCounts]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      categoryScrollRef.current
        ?.querySelector<HTMLElement>(`[data-category="${category}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      syncCategoryScrollState();
    });
    return () => cancelAnimationFrame(frame);
  }, [category]);

  const scrollCategories = (direction: -1 | 1) => {
    const node = categoryScrollRef.current;
    if (!node) return;
    node.scrollBy({ left: direction * Math.max(180, node.clientWidth * 0.7), behavior: 'smooth' });
  };

  for (let i = 0; i < stationCount; i++) {
    const emp = category === 'all' ? stationMap.get(i) : visibleEmployees[i];
    stations.push(
      <Workstation
        key={emp?.id ?? `station-${i}`}
        stationIndex={i}
        employee={emp ?? null}
        isWorking={emp ? isWorking(emp) : false}
        onClick={emp ? () => onStationClick(emp) : undefined}
        onEdit={emp ? () => onStationEdit(emp) : undefined}
      />
    );
  }

  return (
    <section className="office-workspace">
      <header className="office-overview">
        <div className="office-overview-copy">
          <span className="office-kicker">WORKSPACE</span>
          <h1>办公室</h1>
          <p>团队成员、当前状态与工作席位</p>
        </div>
        <div className="office-summary" aria-label="办公室状态">
          <div><strong>{employees.length}</strong><span>成员</span></div>
          <div><strong>{onlineCount}</strong><span>在线</span></div>
          <div className={workingCount ? 'is-active' : ''}><strong>{workingCount}</strong><span>工作中</span></div>
        </div>
      </header>
      <nav className="office-category-nav" aria-label="员工行业分类">
        <button type="button" className="office-category-arrow" aria-label="查看前面的员工分类" title="查看前面的分类" disabled={!categoryScrollState.canBack} onClick={() => scrollCategories(-1)}>
          <LeftOutlined />
        </button>
        <div
          ref={categoryScrollRef}
          className="office-category-scroll"
          onScroll={syncCategoryScrollState}
          onWheel={(event) => {
            const node = categoryScrollRef.current;
            if (!node || node.scrollWidth <= node.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
            event.preventDefault();
            node.scrollLeft += event.deltaY;
          }}
        >
          <button type="button" data-category="all" className={category === 'all' ? 'active' : ''} aria-pressed={category === 'all'} onClick={() => setCategory('all')}>
            <AppstoreOutlined /><span>全部员工</span><strong>{employees.length}</strong>
          </button>
          {EMPLOYEE_CATEGORIES.filter((item) => (categoryCounts.get(item.id) ?? 0) > 0).map((item) => (
            <button type="button" data-category={item.id} key={item.id} className={category === item.id ? 'active' : ''} aria-pressed={category === item.id} onClick={() => setCategory(item.id)} title={item.label}>
              <span>{item.shortLabel}</span><strong>{categoryCounts.get(item.id)}</strong>
            </button>
          ))}
        </div>
        <button type="button" className="office-category-arrow" aria-label="查看更多员工分类" title="查看更多分类" disabled={!categoryScrollState.canForward} onClick={() => scrollCategories(1)}>
          <RightOutlined />
        </button>
        <span className="office-category-result">当前显示 {visibleEmployees.length} 人</span>
      </nav>
      <div className="office-container" role="region" aria-label={`办公室工位，共 ${stationCount} 个位置`} tabIndex={0}>
        <div className="office-grid" data-station-count={stationCount}>
          {stations}
        </div>
      </div>
    </section>
  );
}
