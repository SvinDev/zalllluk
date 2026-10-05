import { DeleteOutlined } from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import { App, Button, DatePicker, Popconfirm, Select, Table } from 'antd'
import type { Dayjs } from 'dayjs'
import { useState } from 'react'
import { Link } from 'react-router'

import { api } from '@/api/client'
import { errorMessage } from '@/api/errors'
import type { MeterKind, ReadingJournalItem, ReadingSource } from '@/api/types'
import { MANAGERS, useAuth } from '@/auth/useAuth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/QueryError'
import { BuildingSelect } from '@/components/selects'
import { dateTime, quantity } from '@/lib/format'
import { meterKindLabels, options, readingSourceLabels } from '@/lib/labels'
import { usePagination } from '@/lib/usePagination'

export default function ReadingsJournalPage() {
  const { hasRole } = useAuth()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const page = usePagination(50)
  const [buildingId, setBuildingId] = useState<number>()
  const [kind, setKind] = useState<MeterKind>()
  const [source, setSource] = useState<ReadingSource>()
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)

  const { data, isLoading, error } = api.useQuery('get', '/api/v1/readings', {
    params: {
      query: {
        ...page.query,
        building_id: buildingId,
        kind,
        source,
        date_from: range?.[0]?.format('YYYY-MM-DD'),
        date_to: range?.[1]?.format('YYYY-MM-DD'),
      },
    },
  })
  const remove = api.useMutation('delete', '/api/v1/readings/{reading_id}')

  return (
    <>
      <PageHeader
        title="Журнал показаний"
        extra={
          <>
            <BuildingSelect style={{ width: 240 }} value={buildingId} onChange={(v) => { setBuildingId(v); page.reset() }} />
            <Select placeholder="Тип" allowClear style={{ width: 160 }} options={options(meterKindLabels)} value={kind} onChange={(v) => { setKind(v); page.reset() }} />
            <Select placeholder="Источник" allowClear style={{ width: 160 }} options={options(readingSourceLabels)} value={source} onChange={(v) => { setSource(v); page.reset() }} />
            <DatePicker.RangePicker format="DD.MM.YYYY" value={range} onChange={(v) => { setRange(v); page.reset() }} />
          </>
        }
      />
      <QueryError error={error} />
      <Table<ReadingJournalItem>
        rowKey="id"
        size="small"
        loading={isLoading}
        dataSource={data?.items}
        pagination={page.table(data?.total)}
        scroll={{ x: 900 }}
        columns={[
          { title: 'Дата', dataIndex: 'taken_at', render: dateTime, width: 150 },
          {
            title: 'Помещение',
            render: (_, r) => (
              <Link to={`/apartments/${r.meter.apartment.id}`}>
                {r.meter.apartment.building.address}, кв. {r.meter.apartment.number}
              </Link>
            ),
          },
          { title: 'Счётчик', render: (_, r) => `${meterKindLabels[r.meter.kind]} № ${r.meter.serial_number}` },
          { title: 'Показание', dataIndex: 'value', align: 'right', render: (v) => quantity(v) },
          { title: 'Расход', dataIndex: 'consumption', align: 'right', render: (v, r) => quantity(v, r.meter.unit) },
          { title: 'Источник', dataIndex: 'source', render: (s: ReadingSource) => readingSourceLabels[s] },
          ...(hasRole(...MANAGERS)
            ? [
                {
                  key: 'delete',
                  width: 50,
                  render: (_: unknown, r: ReadingJournalItem) => (
                    <Popconfirm
                      title="Удалить ошибочное показание?"
                      onConfirm={async () => {
                        try {
                          await remove.mutateAsync({ params: { path: { reading_id: r.id } } })
                          await queryClient.invalidateQueries({ queryKey: ['get', '/api/v1/readings'] })
                        } catch (e) {
                          message.error(errorMessage(e))
                        }
                      }}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  ),
                },
              ]
            : []),
        ]}
      />
    </>
  )
}
