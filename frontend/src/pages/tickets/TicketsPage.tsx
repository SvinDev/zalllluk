import { PlusOutlined } from '@ant-design/icons'
import { Button, Checkbox, Input, Select, Table, Tag } from 'antd'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import { api } from '@/api/client'
import type { TicketCategory, TicketPriority, TicketRead, TicketStatus } from '@/api/types'
import { useAuth } from '@/auth/useAuth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/QueryError'
import { StatusTag } from '@/components/StatusTag'
import { TicketCreateModal } from '@/components/TicketCreateModal'
import { BuildingSelect } from '@/components/selects'
import { dateTime } from '@/lib/format'
import { options, ticketCategoryLabels, ticketPriorities, ticketStatuses } from '@/lib/labels'
import { usePagination } from '@/lib/usePagination'

export default function TicketsPage() {
  const { user } = useAuth()
  const isStaff = user?.role !== 'resident'
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const page = usePagination()
  const [statuses, setStatuses] = useState<TicketStatus[]>([])
  const [category, setCategory] = useState<TicketCategory>()
  const [priority, setPriority] = useState<TicketPriority>()
  const [buildingId, setBuildingId] = useState<number>()
  const [onlyOpen, setOnlyOpen] = useState(params.has('only_open'))
  const [overdue, setOverdue] = useState(false)
  const [mine, setMine] = useState(false)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)

  const { data, isLoading, error } = api.useQuery('get', '/api/v1/tickets', {
    params: {
      query: {
        ...page.query,
        status: statuses.length ? statuses : undefined,
        category,
        priority,
        building_id: buildingId,
        assignee_id: mine ? user?.id : undefined,
        only_open: onlyOpen || undefined,
        overdue: overdue || undefined,
        search: search || undefined,
      },
    },
  })
  const reset = () => page.reset()

  return (
    <>
      <PageHeader
        title="Заявки и обращения"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            Новая заявка
          </Button>
        }
      />
      {isStaff && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
          <Select mode="multiple" placeholder="Статусы" allowClear style={{ minWidth: 220 }} options={options(ticketStatuses)} value={statuses} onChange={(v) => { setStatuses(v); reset() }} />
          <Select placeholder="Категория" allowClear style={{ width: 180 }} options={options(ticketCategoryLabels)} value={category} onChange={(v) => { setCategory(v); reset() }} />
          <Select placeholder="Приоритет" allowClear style={{ width: 150 }} options={options(ticketPriorities)} value={priority} onChange={(v) => { setPriority(v); reset() }} />
          <BuildingSelect style={{ width: 240 }} value={buildingId} onChange={(v) => { setBuildingId(v); reset() }} />
          <Input.Search placeholder="Поиск по тексту" allowClear style={{ width: 200 }} onSearch={(v) => { setSearch(v); reset() }} />
          <Checkbox checked={onlyOpen} onChange={(e) => { setOnlyOpen(e.target.checked); reset() }}>Открытые</Checkbox>
          <Checkbox checked={overdue} onChange={(e) => { setOverdue(e.target.checked); reset() }}>Просроченные</Checkbox>
          <Checkbox checked={mine} onChange={(e) => { setMine(e.target.checked); reset() }}>Назначены мне</Checkbox>
        </div>
      )}
      <QueryError error={error} />
      <Table<TicketRead>
        rowKey="id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={page.table(data?.total)}
        scroll={{ x: 1000 }}
        onRow={(t) => ({ onClick: () => navigate(`/tickets/${t.id}`), style: { cursor: 'pointer' } })}
        columns={[
          { title: '№', dataIndex: 'id', width: 70, render: (id) => <Link to={`/tickets/${id}`}>{id}</Link> },
          {
            title: 'Тема',
            dataIndex: 'subject',
            render: (s, t) => (
              <>
                {s}
                <div style={{ fontSize: 12, color: '#888' }}>
                  {t.building.address}
                  {t.apartment ? `, кв. ${t.apartment.number}` : ' (общедомовая)'}
                </div>
              </>
            ),
          },
          { title: 'Категория', dataIndex: 'category', render: (c: TicketCategory) => ticketCategoryLabels[c] },
          { title: 'Приоритет', dataIndex: 'priority', render: (p: TicketPriority) => <StatusTag value={p} map={ticketPriorities} /> },
          { title: 'Статус', dataIndex: 'status', render: (s: TicketStatus, t) => <><StatusTag value={s} map={ticketStatuses} />{t.is_overdue && <Tag color="red">просрочена</Tag>}</> },
          ...(isStaff ? [{ title: 'Исполнитель', key: 'assignee', render: (_: unknown, t: TicketRead) => t.assignee?.full_name ?? '—' }] : []),
          { title: 'Создана', dataIndex: 'created_at', render: dateTime, width: 150 },
          { title: 'Срок', dataIndex: 'due_at', render: dateTime, width: 150 },
        ]}
      />
      <TicketCreateModal open={creating} onClose={() => setCreating(false)} />
    </>
  )
}
