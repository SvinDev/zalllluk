import { DatePicker, Input, Select, Table } from 'antd'
import type { Dayjs } from 'dayjs'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { api } from '@/api/client'
import type { InvoiceRead, InvoiceStatus } from '@/api/types'
import { useAuth } from '@/auth/useAuth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/QueryError'
import { StatusTag } from '@/components/StatusTag'
import { BuildingSelect } from '@/components/selects'
import { date, money, period, periodParam } from '@/lib/format'
import { invoiceStatuses, options } from '@/lib/labels'
import { usePagination } from '@/lib/usePagination'

export default function InvoicesPage() {
  const { user } = useAuth()
  const isStaff = user?.role !== 'resident'
  const navigate = useNavigate()
  const page = usePagination()
  const [month, setMonth] = useState<Dayjs | null>(null)
  const [status, setStatus] = useState<InvoiceStatus>()
  const [buildingId, setBuildingId] = useState<number>()
  const [search, setSearch] = useState('')

  const { data, isLoading, error } = api.useQuery('get', '/api/v1/invoices', {
    params: {
      query: {
        ...page.query,
        period: month ? periodParam(month) : undefined,
        status,
        building_id: buildingId,
        search: search || undefined,
      },
    },
  })

  return (
    <>
      <PageHeader
        title="Квитанции"
        extra={
          <>
            <DatePicker picker="month" format="MMMM YYYY" placeholder="Период" value={month} onChange={(v) => { setMonth(v); page.reset() }} />
            {isStaff && (
              <>
                <Select
                  placeholder="Статус"
                  allowClear
                  style={{ width: 190 }}
                  options={options(invoiceStatuses)}
                  value={status}
                  onChange={(v) => { setStatus(v); page.reset() }}
                />
                <BuildingSelect style={{ width: 240 }} value={buildingId} onChange={(v) => { setBuildingId(v); page.reset() }} />
                <Input.Search placeholder="Номер, л/с" allowClear style={{ width: 180 }} onSearch={(v) => { setSearch(v); page.reset() }} />
              </>
            )}
          </>
        }
      />
      <QueryError error={error} />
      <Table<InvoiceRead>
        rowKey="id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={page.table(data?.total)}
        scroll={{ x: 900 }}
        onRow={(i) => ({ onClick: () => navigate(`/invoices/${i.id}`), style: { cursor: 'pointer' } })}
        columns={[
          { title: 'Период', dataIndex: 'period', render: (p, i) => <Link to={`/invoices/${i.id}`}>{period(p)}</Link> },
          { title: 'Номер', dataIndex: 'number' },
          { title: 'Адрес', render: (_, i) => `${i.apartment.building.address}, кв. ${i.apartment.number}` },
          { title: 'Начислено', dataIndex: 'amount', align: 'right', render: money },
          { title: 'К оплате', dataIndex: 'total_due', align: 'right', render: money },
          { title: 'Оплачено', dataIndex: 'paid_amount', align: 'right', render: money },
          { title: 'Срок', dataIndex: 'due_date', render: date },
          { title: 'Статус', dataIndex: 'status', render: (s: InvoiceStatus) => <StatusTag value={s} map={invoiceStatuses} /> },
        ]}
      />
    </>
  )
}
