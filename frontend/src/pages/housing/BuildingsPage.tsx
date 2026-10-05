import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Space, Table } from 'antd'
import { useState } from 'react'
import { Link } from 'react-router'

import { api } from '@/api/client'
import { errorMessage } from '@/api/errors'
import type { BuildingRead } from '@/api/types'
import { MANAGERS, useAuth } from '@/auth/useAuth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/QueryError'
import { usePagination } from '@/lib/usePagination'

type Values = { address: string; floors?: number; entrances?: number; year_built?: number; notes?: string }

export default function BuildingsPage() {
  const { hasRole } = useAuth()
  const canEdit = hasRole(...MANAGERS)
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<BuildingRead | 'new' | null>(null)
  const [form] = Form.useForm<Values>()
  const page = usePagination()

  const { data, isLoading, error } = api.useQuery('get', '/api/v1/buildings', {
    params: { query: { ...page.query, search: search || undefined } },
  })
  const create = api.useMutation('post', '/api/v1/buildings')
  const update = api.useMutation('patch', '/api/v1/buildings/{building_id}')
  const remove = api.useMutation('delete', '/api/v1/buildings/{building_id}')

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['get', '/api/v1/buildings'] })

  const save = async () => {
    const values = await form.validateFields()
    try {
      if (editing === 'new') await create.mutateAsync({ body: values })
      else if (editing) await update.mutateAsync({ params: { path: { building_id: editing.id } }, body: values })
      message.success('Сохранено')
      setEditing(null)
      await refresh()
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  return (
    <>
      <PageHeader
        title="Дома"
        extra={
          <>
            <Input.Search placeholder="Поиск по адресу" allowClear onSearch={(v) => { setSearch(v); page.reset() }} style={{ width: 260 }} />
            {canEdit && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setEditing('new') }}>
                Добавить дом
              </Button>
            )}
          </>
        }
      />
      <QueryError error={error} />
      <Table<BuildingRead>
        rowKey="id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={page.table(data?.total)}
        scroll={{ x: 700 }}
        columns={[
          { title: 'Адрес', dataIndex: 'address', render: (address, b) => <Link to={`/apartments?building_id=${b.id}`}>{address}</Link> },
          { title: 'Помещений', dataIndex: 'apartments_count', align: 'right', width: 120 },
          { title: 'Этажей', dataIndex: 'floors', align: 'right', width: 100 },
          { title: 'Подъездов', dataIndex: 'entrances', align: 'right', width: 110 },
          { title: 'Год постройки', dataIndex: 'year_built', align: 'right', width: 140 },
          ...(canEdit
            ? [
                {
                  key: 'actions',
                  width: 100,
                  render: (_: unknown, b: BuildingRead) => (
                    <Space>
                      <Button size="small" icon={<EditOutlined />} onClick={() => { form.setFieldsValue({ ...b, notes: b.notes ?? undefined, floors: b.floors ?? undefined, entrances: b.entrances ?? undefined, year_built: b.year_built ?? undefined }); setEditing(b) }} />
                      <Popconfirm
                        title="Удалить дом?"
                        onConfirm={async () => {
                          try {
                            await remove.mutateAsync({ params: { path: { building_id: b.id } } })
                            await refresh()
                          } catch (e) {
                            message.error(errorMessage(e))
                          }
                        }}
                      >
                        <Button size="small" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />
      <Modal
        open={editing !== null}
        title={editing === 'new' ? 'Новый дом' : 'Редактирование дома'}
        onOk={save}
        onCancel={() => setEditing(null)}
        confirmLoading={create.isPending || update.isPending}
        okText="Сохранить"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="address" label="Адрес" rules={[{ required: true, min: 3 }]}>
            <Input placeholder="г. Москва, ул. Лесная, д. 12" />
          </Form.Item>
          <Space wrap>
            <Form.Item name="floors" label="Этажей"><InputNumber min={1} max={200} /></Form.Item>
            <Form.Item name="entrances" label="Подъездов"><InputNumber min={1} max={100} /></Form.Item>
            <Form.Item name="year_built" label="Год постройки"><InputNumber min={1800} max={2100} /></Form.Item>
          </Space>
          <Form.Item name="notes" label="Заметки"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
    </>
  )
}
