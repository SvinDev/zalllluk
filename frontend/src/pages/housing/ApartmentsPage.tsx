import { PlusOutlined } from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import { App, Button, Form, Input, InputNumber, Modal, Table } from 'antd'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import { api } from '@/api/client'
import { errorMessage } from '@/api/errors'
import type { ApartmentRead } from '@/api/types'
import { MANAGERS, useAuth } from '@/auth/useAuth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/QueryError'
import { BuildingSelect } from '@/components/selects'
import { quantity } from '@/lib/format'
import { usePagination } from '@/lib/usePagination'

type Values = {
  building_id: number
  number: string
  account_number: string
  area: number
  residents_count: number
  owner_name?: string
}

export default function ApartmentsPage() {
  const { hasRole } = useAuth()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const buildingId = params.get('building_id') ? Number(params.get('building_id')) : undefined
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [form] = Form.useForm<Values>()
  const page = usePagination()

  const { data, isLoading, error } = api.useQuery('get', '/api/v1/apartments', {
    params: { query: { ...page.query, building_id: buildingId, search: search || undefined } },
  })
  const create = api.useMutation('post', '/api/v1/apartments')

  const save = async () => {
    const values = await form.validateFields()
    try {
      const created = await create.mutateAsync({ body: values })
      await queryClient.invalidateQueries({ queryKey: ['get', '/api/v1/apartments'] })
      setCreating(false)
      navigate(`/apartments/${created.id}`)
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  return (
    <>
      <PageHeader
        title="Помещения и лицевые счета"
        extra={
          <>
            <BuildingSelect
              style={{ width: 280 }}
              value={buildingId}
              onChange={(value) => {
                page.reset()
                setParams(value ? { building_id: String(value) } : {})
              }}
            />
            <Input.Search placeholder="Квартира, л/с, собственник" allowClear onSearch={(v) => { setSearch(v); page.reset() }} style={{ width: 260 }} />
            {hasRole(...MANAGERS) && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); form.setFieldValue('building_id', buildingId); setCreating(true) }}>
                Добавить
              </Button>
            )}
          </>
        }
      />
      <QueryError error={error} />
      <Table<ApartmentRead>
        rowKey="id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={page.table(data?.total)}
        scroll={{ x: 800 }}
        onRow={(a) => ({ onClick: () => navigate(`/apartments/${a.id}`), style: { cursor: 'pointer' } })}
        columns={[
          { title: 'Адрес', render: (_, a) => a.building.address },
          { title: 'Кв.', dataIndex: 'number', width: 70, render: (n, a) => <Link to={`/apartments/${a.id}`}>{n}</Link> },
          { title: 'Лицевой счёт', dataIndex: 'account_number', width: 140 },
          { title: 'Собственник', dataIndex: 'owner_name' },
          { title: 'Площадь', dataIndex: 'area', align: 'right', width: 110, render: (v) => quantity(v, 'м²') },
          { title: 'Проживает', dataIndex: 'residents_count', align: 'right', width: 110 },
        ]}
      />
      <Modal open={creating} title="Новое помещение" onOk={save} onCancel={() => setCreating(false)} confirmLoading={create.isPending} okText="Создать">
        <Form form={form} layout="vertical" initialValues={{ residents_count: 1 }}>
          <Form.Item name="building_id" label="Дом" rules={[{ required: true }]}><BuildingSelect /></Form.Item>
          <Form.Item name="number" label="Номер помещения" rules={[{ required: true }]}><Input maxLength={20} /></Form.Item>
          <Form.Item name="account_number" label="Лицевой счёт" rules={[{ required: true, pattern: /^[\w-]+$/, message: 'Цифры, буквы и дефис' }]}>
            <Input maxLength={32} />
          </Form.Item>
          <Form.Item name="area" label="Площадь, м²" rules={[{ required: true }]}><InputNumber min={0.01} step={0.1} precision={2} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="residents_count" label="Проживает (для начислений)"><InputNumber min={0} max={100} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="owner_name" label="Собственник"><Input maxLength={255} /></Form.Item>
        </Form>
      </Modal>
    </>
  )
}
