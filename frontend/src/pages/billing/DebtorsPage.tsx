import { InputNumber, Space, Table, Typography } from 'antd'
import { useState } from 'react'
import { Link } from 'react-router'

import { api } from '@/api/client'
import type { DebtorRow } from '@/api/types'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/QueryError'
import { BuildingSelect } from '@/components/selects'
import { dateTime, money } from '@/lib/format'
import { usePagination } from '@/lib/usePagination'

export default function DebtorsPage() {
  const page = usePagination(50)
  const [buildingId, setBuildingId] = useState<number>()
  const [minDebt, setMinDebt] = useState<number>(1000)

  const { data, isLoading, error } = api.useQuery('get', '/api/v1/billing/debtors', {
    params: { query: { ...page.query, building_id: buildingId, min_debt: minDebt } },
  })

  return (
    <>
      <PageHeader
        title="Должники"
        extra={
          <>
            <BuildingSelect style={{ width: 260 }} value={buildingId} onChange={(v) => { setBuildingId(v); page.reset() }} />
            <Space>
              <Typography.Text type="secondary">Долг от</Typography.Text>
              <InputNumber min={0} step={500} value={minDebt} onChange={(v) => { setMinDebt(v ?? 0); page.reset() }} suffix="₽" style={{ width: 150 }} />
            </Space>
          </>
        }
      />
      <QueryError error={error} />
      <Table<DebtorRow>
        rowKey={(r) => r.apartment.id}
        loading={isLoading}
        dataSource={data?.items}
        pagination={page.table(data?.total)}
        scroll={{ x: 700 }}
        columns={[
          {
            title: 'Помещение',
            render: (_, r) => (
              <Link to={`/apartments/${r.apartment.id}`}>
                {r.apartment.building.address}, кв. {r.apartment.number}
              </Link>
            ),
          },
          { title: 'Лицевой счёт', render: (_, r) => r.apartment.account_number },
          { title: 'Собственник', dataIndex: 'owner_name' },
          {
            title: 'Долг',
            dataIndex: 'balance',
            align: 'right',
            render: (b) => <Typography.Text type="danger" strong>{money(b)}</Typography.Text>,
          },
          { title: 'Последняя оплата', dataIndex: 'last_payment_at', render: (d) => (d ? dateTime(d) : <Typography.Text type="danger">не было</Typography.Text>) },
        ]}
      />
    </>
  )
}
