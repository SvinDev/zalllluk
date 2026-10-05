import { Drawer, Table } from 'antd'
import { useState } from 'react'

import { api } from '@/api/client'
import type { MeterRead, ReadingRead } from '@/api/types'
import { dateTime, quantity } from '@/lib/format'
import { meterKindLabels, readingSourceLabels } from '@/lib/labels'

export function MeterHistoryDrawer({ meter, onClose }: { meter: MeterRead | null; onClose: () => void }) {
  const [page, setPage] = useState(1)
  const { data, isLoading } = api.useQuery(
    'get',
    '/api/v1/meters/{meter_id}/readings',
    { params: { path: { meter_id: meter?.id ?? 0 }, query: { limit: 20, offset: (page - 1) * 20 } } },
    { enabled: !!meter },
  )
  return (
    <Drawer
      open={!!meter}
      onClose={onClose}
      width={560}
      title={meter ? `${meterKindLabels[meter.kind]} · № ${meter.serial_number}` : ''}
      destroyOnHidden
    >
      <Table<ReadingRead>
        rowKey="id"
        size="small"
        loading={isLoading}
        dataSource={data?.items}
        pagination={{ current: page, pageSize: 20, total: data?.total, onChange: setPage, showSizeChanger: false }}
        columns={[
          { title: 'Дата', dataIndex: 'taken_at', render: dateTime },
          { title: 'Показание', dataIndex: 'value', align: 'right', render: (v) => quantity(v) },
          { title: 'Расход', dataIndex: 'consumption', align: 'right', render: (v) => quantity(v, meter?.unit) },
          { title: 'Источник', dataIndex: 'source', render: (s: keyof typeof readingSourceLabels) => readingSourceLabels[s] },
        ]}
      />
    </Drawer>
  )
}
