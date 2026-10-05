import { EditOutlined, PlusOutlined } from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import { App, Button, Form, Input, Modal, Select, Switch, Table, Tag } from 'antd'
import { useState } from 'react'

import { api } from '@/api/client'
import { errorMessage } from '@/api/errors'
import type { UserRead, UserRole } from '@/api/types'
import { useAuth } from '@/auth/useAuth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/QueryError'
import { date } from '@/lib/format'
import { options, roleLabels } from '@/lib/labels'
import { usePagination } from '@/lib/usePagination'

type Values = {
  email: string
  full_name: string
  phone?: string
  role: UserRole
  password?: string
  is_active?: boolean
}

export default function UsersPage() {
  const { user: me, hasRole } = useAuth()
  const isAdmin = hasRole('admin')
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [role, setRole] = useState<UserRole>()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<UserRead | 'new' | null>(null)
  const [form] = Form.useForm<Values>()
  const page = usePagination()

  const { data, isLoading, error } = api.useQuery('get', '/api/v1/users', {
    params: { query: { ...page.query, role, search: search || undefined } },
  })
  const create = api.useMutation('post', '/api/v1/users')
  const update = api.useMutation('patch', '/api/v1/users/{user_id}')

  // Управляющий заводит только жителей — так же ограничивает и API.
  const roleOptions = isAdmin ? options(roleLabels) : [{ value: 'resident', label: roleLabels.resident }]

  const save = async () => {
    const values = await form.validateFields()
    try {
      if (editing === 'new') {
        await create.mutateAsync({ body: { ...values, password: values.password! } })
      } else if (editing) {
        const { email: _email, ...changes } = values
        await update.mutateAsync({
          params: { path: { user_id: editing.id } },
          body: { ...changes, password: changes.password || undefined },
        })
      }
      message.success('Сохранено')
      setEditing(null)
      await queryClient.invalidateQueries({ queryKey: ['get', '/api/v1/users'] })
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  return (
    <>
      <PageHeader
        title="Пользователи"
        extra={
          <>
            <Select placeholder="Роль" allowClear options={options(roleLabels)} style={{ width: 180 }} value={role} onChange={(v) => { setRole(v); page.reset() }} />
            <Input.Search placeholder="ФИО, email, телефон" allowClear onSearch={(v) => { setSearch(v); page.reset() }} style={{ width: 240 }} />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); form.setFieldsValue({ role: 'resident' }); setEditing('new') }}>
              Добавить
            </Button>
          </>
        }
      />
      <QueryError error={error} />
      <Table<UserRead>
        rowKey="id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={page.table(data?.total)}
        scroll={{ x: 800 }}
        columns={[
          { title: 'ФИО', dataIndex: 'full_name' },
          { title: 'Email', dataIndex: 'email' },
          { title: 'Телефон', dataIndex: 'phone' },
          { title: 'Роль', dataIndex: 'role', render: (r: UserRole) => roleLabels[r] },
          { title: 'Статус', dataIndex: 'is_active', render: (active) => (active ? <Tag color="green">активен</Tag> : <Tag>заблокирован</Tag>) },
          { title: 'Создан', dataIndex: 'created_at', render: date },
          {
            key: 'edit',
            width: 60,
            render: (_, u) =>
              (isAdmin || u.role === 'resident') && (
                <Button
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => {
                    form.setFieldsValue({ ...u, phone: u.phone ?? undefined, password: undefined })
                    setEditing(u)
                  }}
                />
              ),
          },
        ]}
      />
      <Modal
        open={editing !== null}
        title={editing === 'new' ? 'Новый пользователь' : 'Пользователь'}
        onOk={save}
        onCancel={() => setEditing(null)}
        confirmLoading={create.isPending || update.isPending}
        okText="Сохранить"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
            <Input disabled={editing !== 'new'} />
          </Form.Item>
          <Form.Item name="full_name" label="ФИО" rules={[{ required: true }]}>
            <Input maxLength={255} />
          </Form.Item>
          <Form.Item name="phone" label="Телефон">
            <Input maxLength={32} placeholder="+7 900 000-00-00" />
          </Form.Item>
          <Form.Item name="role" label="Роль" rules={[{ required: true }]}>
            <Select options={roleOptions} disabled={editing !== 'new' && editing?.id === me?.id} />
          </Form.Item>
          <Form.Item
            name="password"
            label={editing === 'new' ? 'Пароль' : 'Новый пароль'}
            extra={editing === 'new' ? undefined : 'Оставьте пустым, чтобы не менять'}
            rules={[{ required: editing === 'new', min: 8, message: 'Минимум 8 символов' }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          {editing !== 'new' && editing?.id !== me?.id && (
            <Form.Item name="is_active" label="Доступ в систему" valuePropName="checked">
              <Switch checkedChildren="активен" unCheckedChildren="заблокирован" />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  )
}
