import { Button, Checkbox, Input, Select, Space, Table, Tag, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { useState } from 'react'
import { Link } from 'react-router'

import { api } from '@/api/client'
import type { MeterKind, MeterRead } from '@/api/types'
import { useAuth } from '@/auth/useAuth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/QueryError'
import { SubmitReadingModal } from '@/components/SubmitReadingModal'
import { BuildingSelect } from '@/components/selects'
import { date, dateTime, quantity } from '@/lib/format'
import { meterKindLabels, options, readingSourceLabels } from '@/lib/labels'
import { usePagination } from '@/lib/usePagination'

import { MeterHistoryDrawer } from './MeterHistoryDrawer'

export default function MetersPage() {
  const { user } = useAuth()
  const isStaff = user?.role !== 'resident'
  const page = usePagination()
  const [buildingId, setBuildingId] = useState<number>()
  const [kind, setKind] = useState<MeterKind>()
  const [search, setSearch] = useState('')
  const [missing, setMissing] = useState(false)
  const [dueSoon, setDueSoon] = useState(false)
  const [submitFor, setSubmitFor] = useState<MeterRead | null>(null)
  const [historyFor, setHistoryFor] = useState<MeterRead | null>(null)

  const monthStart = dayjs().startOf('month')
  const { data, isLoading, error } = api.useQuery('get', '/api/v1/meters', {
    params: {
      query: {
        ...page.query,
        building_id: buildingId,
        kind,
        search: search || undefined,
        no_reading_since: missing ? monthStart.format('YYYY-MM-DD') : undefined,
        verification_due_before: dueSoon ? dayjs().add(30, 'day').format('YYYY-MM-DD') : undefined,
      },
    },
  })

  const reset = () => page.reset()

  return (
    <>
      <PageHeader
        title="Счётчики"
        subtitle={isStaff ? undefined : 'Передавайте показания ежемесячно — иначе начисление будет по среднему'}
        extra={
          isStaff && (
            <>
              <BuildingSelect style={{ width: 260 }} value={buildingId} onChange={(v) => { setBuildingId(v); reset() }} />
              <Select placeholder="Тип" allowClear style={{ width: 170 }} options={options(meterKindLabels)} value={kind} onChange={(v) => { setKind(v); reset() }} />
              <Input.Search placeholder="Заводской №, л/с" allowClear style={{ width: 200 }} onSearch={(v) => { setSearch(v); reset() }} />
            </>
          )
        }
      />
      {isStaff && (
        <Space style={{ marginBottom: 12 }} wrap>
          <Checkbox checked={missing} onChange={(e) => { setMissing(e.target.checked); reset() }}>
            Нет показаний за {monthStart.format('MMMM')}
          </Checkbox>
          <Checkbox checked={dueSoon} onChange={(e) => { setDueSoon(e.target.checked); reset() }}>
            Поверка в ближайшие 30 дней
          </Checkbox>
        </Space>
      )}
      <QueryError error={error} />
      <Table<MeterRead>
        rowKey="id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={page.table(data?.total)}
        scroll={{ x: 900 }}
        columns={[
          ...(isStaff
            ? [
                {
                  title: 'Помещение',
                  key: 'apartment',
                  render: (_: unknown, m: MeterRead) => (
                    <Link to={`/apartments/${m.apartment.id}`}>
                      {m.apartment.building.address}, кв. {m.apartment.number}
                    </Link>
                  ),
                },
              ]
            : []),
          { title: 'Тип', dataIndex: 'kind', render: (k: MeterKind) => meterKindLabels[k] },
          {
            title: 'Заводской №',
            dataIndex: 'serial_number',
            render: (sn, m) => (
              <Space>
                {sn}
                {!m.is_active && <Tag>выведен</Tag>}
                {m.external_id && <Tooltip title={`Внешний ID: ${m.external_id}`}><Tag color="purple">АСКУЭ</Tag></Tooltip>}
              </Space>
            ),
          },
          {
            title: 'Поверка до',
            dataIndex: 'verification_due',
            render: (d) => {
              const soon = d && dayjs(d).isBefore(dayjs().add(30, 'day'))
              return soon ? <Tag color="orange">{date(d)}</Tag> : date(d)
            },
          },
          {
            title: 'Последнее показание',
            render: (_, m) =>
              m.last_reading ? (
                <Tooltip title={`${dateTime(m.last_reading.taken_at)} · ${readingSourceLabels[m.last_reading.source]}`}>
                  {quantity(m.last_reading.value, m.unit)}
                  {dayjs(m.last_reading.taken_at).isBefore(monthStart) && <Tag color="orange" style={{ marginLeft: 8 }}>устарело</Tag>}
                </Tooltip>
              ) : (
                '—'
              ),
          },
          {
            key: 'actions',
            width: 230,
            render: (_, m) => (
              <Space>
                <Button size="small" type="primary" disabled={!m.is_active} onClick={() => setSubmitFor(m)}>
                  Передать
                </Button>
                <Button size="small" onClick={() => setHistoryFor(m)}>
                  История
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <SubmitReadingModal meter={submitFor} allowBackdate={isStaff} onClose={() => setSubmitFor(null)} />
      <MeterHistoryDrawer meter={historyFor} onClose={() => setHistoryFor(null)} />
    </>
  )
}
