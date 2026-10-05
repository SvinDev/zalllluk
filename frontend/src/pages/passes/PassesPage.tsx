import { CheckOutlined, CloseOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import { App, Button, Checkbox, Input, Modal, Popconfirm, Result, Select, Space, Table, Typography } from 'antd'
import { useState } from 'react'
import { useSearchParams } from 'react-router'

import { api } from '@/api/client'
import { errorMessage } from '@/api/errors'
import type { PassDetail, PassKind, PassRead } from '@/api/types'
import { GUARDS, useAuth } from '@/auth/useAuth'
import { PageHeader } from '@/components/PageHeader'
import { PassCreateModal } from '@/components/PassCreateModal'
import { QueryError } from '@/components/QueryError'
import { StatusTag } from '@/components/StatusTag'
import { dateTime } from '@/lib/format'
import { options, passKindLabels, passStatuses } from '@/lib/labels'
import { usePagination } from '@/lib/usePagination'

type StoredStatus = Exclude<PassRead['status'], 'expired'>

export default function PassesPage() {
  const { user, hasRole } = useAuth()
  const isStaff = user?.role !== 'resident'
  const canReview = hasRole(...GUARDS)
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const page = usePagination()
  const [status, setStatus] = useState<StoredStatus | undefined>((params.get('status') as StoredStatus) ?? undefined)
  const [kind, setKind] = useState<PassKind>()
  const [activeNow, setActiveNow] = useState(false)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<PassDetail | null>(null)
  const [rejecting, setRejecting] = useState<PassRead | null>(null)
  const [reason, setReason] = useState('')

  const { data, isLoading, error } = api.useQuery('get', '/api/v1/passes', {
    params: {
      query: { ...page.query, status, kind, active_now: activeNow || undefined, search: search || undefined },
    },
  })
  const approve = api.useMutation('post', '/api/v1/passes/{pass_id}/approve')
  const reject = api.useMutation('post', '/api/v1/passes/{pass_id}/reject')
  const cancel = api.useMutation('post', '/api/v1/passes/{pass_id}/cancel')

  const act = async (action: () => Promise<unknown>) => {
    try {
      await action()
      await queryClient.invalidateQueries({ queryKey: ['get', '/api/v1/passes'] })
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  return (
    <>
      <PageHeader
        title="Пропуска"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            Заказать пропуск
          </Button>
        }
      />
      <Space wrap style={{ marginBottom: 12 }}>
        <Select<StoredStatus>
          placeholder="Статус"
          allowClear
          style={{ width: 180 }}
          options={options(passStatuses).filter((o) => o.value !== 'expired')}
          value={status}
          onChange={(v) => { setStatus(v); page.reset() }}
        />
        <Select placeholder="Тип" allowClear style={{ width: 150 }} options={options(passKindLabels)} value={kind} onChange={(v) => { setKind(v); page.reset() }} />
        {isStaff && <Input.Search placeholder="Код, гость, госномер" allowClear style={{ width: 220 }} onSearch={(v) => { setSearch(v); page.reset() }} />}
        <Checkbox checked={activeNow} onChange={(e) => { setActiveNow(e.target.checked); page.reset() }}>Действуют сейчас</Checkbox>
      </Space>
      <QueryError error={error} />
      <Table<PassRead>
        rowKey="id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={page.table(data?.total)}
        scroll={{ x: 1000 }}
        columns={[
          { title: 'Код', dataIndex: 'code', render: (c) => <Typography.Text code copyable>{c}</Typography.Text> },
          { title: 'Тип', dataIndex: 'kind', render: (k: PassKind) => passKindLabels[k] },
          { title: 'Кто', render: (_, p) => [p.visitor_name, p.vehicle_plate].filter(Boolean).join(' · ') || '—' },
          ...(isStaff ? [{ title: 'Куда', key: 'apt', render: (_: unknown, p: PassRead) => `${p.apartment.building.address}, кв. ${p.apartment.number}` }] : []),
          { title: 'Действует', render: (_, p) => `${dateTime(p.valid_from)} — ${dateTime(p.valid_until)}${p.is_one_time ? ' · разовый' : ''}` },
          { title: 'Статус', dataIndex: 'status', render: (s: PassRead['status']) => <StatusTag value={s} map={passStatuses} /> },
          {
            key: 'actions',
            render: (_, p) => (
              <Space>
                {canReview && p.status === 'pending' && (
                  <>
                    <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => act(() => approve.mutateAsync({ params: { path: { pass_id: p.id } } }))}>
                      Согласовать
                    </Button>
                    <Button size="small" danger icon={<CloseOutlined />} onClick={() => { setRejecting(p); setReason('') }} />
                  </>
                )}
                {(p.status === 'pending' || p.status === 'active') && (isStaff || p.created_by?.id === user?.id) && (
                  <Popconfirm title="Отменить пропуск?" onConfirm={() => act(() => cancel.mutateAsync({ params: { path: { pass_id: p.id } } }))}>
                    <Button size="small" icon={<StopOutlined />}>Отменить</Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />
      <PassCreateModal open={creating} onClose={() => setCreating(false)} onCreated={setCreated} />
      <Modal open={!!created} footer={null} onCancel={() => setCreated(null)}>
        {created && (
          <Result
            status={created.status === 'pending' ? 'info' : 'success'}
            title={created.status === 'pending' ? 'Пропуск ждёт согласования УК' : 'Пропуск оформлен'}
            subTitle="Сообщите гостю код — его назовут на посту охраны"
            extra={<Typography.Title copyable style={{ letterSpacing: 6 }}>{created.code}</Typography.Title>}
          />
        )}
      </Modal>
      <Modal
        open={!!rejecting}
        title="Отклонить пропуск"
        okText="Отклонить"
        okButtonProps={{ danger: true, disabled: !reason.trim() }}
        onCancel={() => setRejecting(null)}
        onOk={async () => {
          if (!rejecting) return
          await act(() => reject.mutateAsync({ params: { path: { pass_id: rejecting.id } }, body: { reason } }))
          setRejecting(null)
        }}
      >
        <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина" />
      </Modal>
    </>
  )
}
