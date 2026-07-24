import type { Employee } from '../types';

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g] = [c, x]; else if (h < 120) [r, g] = [x, c]; else if (h < 180) [g, b] = [c, x]; else if (h < 240) [g, b] = [x, c]; else if (h < 300) [r, b] = [x, c]; else [r, b] = [c, x];
  return `#${[r, g, b].map((value) => Math.round((value + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

export function generateDistinctEmployeeColor(existing: string[], seed = Date.now()): string {
  const used = new Set(existing.map((color) => color.toLowerCase()));
  const start = Math.abs(seed) % 360;
  for (let index = 0; index < 24; index += 1) {
    const hue = (start + index * 137.508) % 360;
    const color = hslToHex(hue, 72, index % 2 ? 58 : 48);
    if (!used.has(color.toLowerCase())) return color;
  }
  return hslToHex(Math.random() * 360, 72, 52);
}

export function ensureDistinctEmployeeColors(employees: Employee[]): { employees: Employee[]; changed: boolean } {
  const used: string[] = [];
  let changed = false;
  const next = employees.map((employee, index) => {
    const color = employee.statusColor?.toLowerCase();
    if (color && !used.includes(color)) { used.push(color); return employee; }
    const statusColor = generateDistinctEmployeeColor(used, index * 97 + employee.name.length * 31);
    used.push(statusColor.toLowerCase()); changed = true;
    return { ...employee, statusColor };
  });
  return { employees: next, changed };
}
