import { Tag } from 'antd'

export function StatusTag<K extends string>({
  value,
  map,
}: {
  value: K
  map: Record<K, { label: string; color: string }>
}) {
  const item = map[value]
  return <Tag color={item?.color}>{item?.label ?? value}</Tag>
}
