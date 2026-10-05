import { DeleteOutlined, EditOutlined, PlusOutlined, PushpinFilled } from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import { App, Button, Card, Checkbox, DatePicker, Empty, Flex, Form, Input, List, Modal, Popconfirm, Tag, Typography } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useState } from 'react'

import { api } from '@/api/client'
import { errorMessage } from '@/api/errors'
import type { AnnouncementRead } from '@/api/types'
import { MANAGERS, useAuth } from '@/auth/useAuth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/QueryError'
import { BuildingSelect } from '@/components/selects'
import { dateTime } from '@/lib/format'
import { usePagination } from '@/lib/usePagination'

type Values = { title: string; body: string; building_id?: number; is_pinned: boolean; published_at?: Dayjs }

export default function AnnouncementsPage() {
  const { hasRole } = useAuth()
  const canEdit = hasRole(...MANAGERS)
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const page = usePagination(10)
  const [editing, setEditing] = useState<AnnouncementRead | 'new' | null>(null)
  const [form] = Form.useForm<Values>()

  const { data, isLoading, error } = api.useQuery('get', '/api/v1/announcements', { params: { query: page.query } })
  const create = api.useMutation('post', '/api/v1/announcements')
  const update = api.useMutation('patch', '/api/v1/announcements/{announcement_id}')
  const remove = api.useMutation('delete', '/api/v1/announcements/{announcement_id}')
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['get', '/api/v1/announcements'] })

  const save = async () => {
    const { published_at, ...v } = await form.validateFields()
    const body = { ...v, published_at: published_at?.toISOString() }
    try {
      if (editing === 'new') await create.mutateAsync({ body })
      else if (editing) {
        const { building_id: _ignored, ...changes } = body
        await update.mutateAsync({ params: { path: { announcement_id: editing.id } }, body: changes })
      }
      setEditing(null)
      await refresh()
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  return (
    <>
      <PageHeader
        title="Объявления"
        extra={
          canEdit && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); form.setFieldsValue({ is_pinned: false }); setEditing('new') }}>
              Опубликовать
            </Button>
          )
        }
      />
      <QueryError error={error} />
      <List
        loading={isLoading}
        dataSource={data?.items ?? []}
        locale={{ emptyText: <Empty description="Объявлений нет" /> }}
        pagination={
          data && data.total > 10
            ? (({ current, pageSize, total, onChange }) => ({ current, pageSize, total, onChange }))(page.table(data.total))
            : false
        }
        renderItem={(a) => {
          const scheduled = dayjs(a.published_at).isAfter(dayjs())
          return (
            <Card style={{ marginBottom: 12 }}>
              <Flex justify="space-between" align="flex-start" gap={12}>
                <div>
                  <Typography.Title level={5} style={{ marginTop: 0 }}>
                    {a.is_pinned && <PushpinFilled style={{ color: '#ff4d4f', marginRight: 8 }} />}
                    {a.title}
                  </Typography.Title>
                  <Flex gap={6} wrap style={{ marginBottom: 8 }}>
                    <Typography.Text type="secondary">{dateTime(a.published_at)}</Typography.Text>
                    <Tag>{a.building ? a.building.address : 'все дома'}</Tag>
                    {scheduled && <Tag color="purple">запланировано</Tag>}
                  </Flex>
                  <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{a.body}</Typography.Paragraph>
                </div>
                {canEdit && (
                  <Flex gap={4}>
                    <Button size="small" icon={<EditOutlined />} onClick={() => { form.setFieldsValue({ ...a, building_id: a.building?.id, published_at: dayjs(a.published_at) }); setEditing(a) }} />
                    <Popconfirm title="Удалить объявление?" onConfirm={async () => { await remove.mutateAsync({ params: { path: { announcement_id: a.id } } }); await refresh() }}>
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Flex>
                )}
              </Flex>
            </Card>
          )
        }}
      />
      <Modal open={editing !== null} title={editing === 'new' ? 'Новое объявление' : 'Объявление'} onOk={save} onCancel={() => setEditing(null)} okText="Сохранить" confirmLoading={create.isPending || update.isPending} width={640}>
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="Заголовок" rules={[{ required: true }]}><Input maxLength={255} /></Form.Item>
          <Form.Item name="body" label="Текст" rules={[{ required: true }]}><Input.TextArea rows={6} maxLength={20000} /></Form.Item>
          <Form.Item name="building_id" label="Дом" extra="Пусто — для всех домов">
            <BuildingSelect disabled={editing !== 'new'} />
          </Form.Item>
          <Flex gap={16} wrap>
            <Form.Item name="published_at" label="Опубликовать" extra="Пусто — сразу">
              <DatePicker showTime format="DD.MM.YYYY HH:mm" />
            </Form.Item>
            <Form.Item name="is_pinned" valuePropName="checked" label=" ">
              <Checkbox>Закрепить</Checkbox>
            </Form.Item>
          </Flex>
        </Form>
      </Modal>
    </>
  )
}
