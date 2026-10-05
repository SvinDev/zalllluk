import { ApiOutlined, KeyOutlined, PlusOutlined, SyncOutlined } from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Form, Input, Modal, Popconfirm, Space, Switch, Table, Tag, Typography } from 'antd'
import { useState } from 'react'

import { api } from '@/api/client'
import { errorMessage } from '@/api/errors'
import type { ApiKeyRead, DataSourceRead } from '@/api/types'
import { PageHeader } from '@/components/PageHeader'
import { dateTime } from '@/lib/format'

const INGEST_EXAMPLE = `curl -X POST ${window.location.origin}/api/v1/integrations/readings \\
  -H "X-API-Key: <ключ>" -H "Content-Type: application/json" \\
  -d '{"readings": [{"serial_number": "ЭЛ-100001", "value": "1234.5",
                     "taken_at": "2026-09-25T10:00:00+03:00"}]}'`

export default function IntegrationsPage() {
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const [keyName, setKeyName] = useState('')
  const [sourceModal, setSourceModal] = useState(false)
  const [form] = Form.useForm<{ name: string; url: string; auth_token?: string }>()

  const keys = api.useQuery('get', '/api/v1/integrations/api-keys')
  const sources = api.useQuery('get', '/api/v1/integrations/sources')
  const createKey = api.useMutation('post', '/api/v1/integrations/api-keys')
  const revokeKey = api.useMutation('post', '/api/v1/integrations/api-keys/{key_id}/revoke')
  const createSource = api.useMutation('post', '/api/v1/integrations/sources')
  const updateSource = api.useMutation('patch', '/api/v1/integrations/sources/{source_id}')
  const syncSource = api.useMutation('post', '/api/v1/integrations/sources/{source_id}/sync')

  const refresh = (path: '/api/v1/integrations/api-keys' | '/api/v1/integrations/sources') =>
    queryClient.invalidateQueries({ queryKey: ['get', path] })

  return (
    <>
      <PageHeader title="Интеграции" subtitle="Автоматический приём показаний счётчиков из АСКУЭ и IoT-систем" />

      <Card title={<Space><KeyOutlined />Входящий API (push)</Space>} style={{ marginBottom: 16 }}>
        <Typography.Paragraph>
          Внешняя система отправляет показания пакетами до 1000 записей. Счётчик определяется по заводскому номеру или
          внешнему ID; повторная отправка безопасна — дубли не создаются.
        </Typography.Paragraph>
        <Typography.Paragraph>
          <pre style={{ fontSize: 12, overflowX: 'auto' }}>{INGEST_EXAMPLE}</pre>
        </Typography.Paragraph>
        <Space style={{ marginBottom: 12 }} wrap>
          <Input placeholder="Название ключа, например «Шлюз АСКУЭ»" value={keyName} onChange={(e) => setKeyName(e.target.value)} style={{ width: 320 }} />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={!keyName.trim()}
            loading={createKey.isPending}
            onClick={async () => {
              try {
                const created = await createKey.mutateAsync({ body: { name: keyName } })
                setKeyName('')
                await refresh('/api/v1/integrations/api-keys')
                modal.success({
                  title: 'Ключ выпущен',
                  width: 560,
                  content: (
                    <>
                      <Alert type="warning" showIcon message="Сохраните ключ — повторно его показать нельзя" style={{ marginBottom: 12 }} />
                      <Typography.Text code copyable style={{ wordBreak: 'break-all' }}>{created.key}</Typography.Text>
                    </>
                  ),
                })
              } catch (e) {
                message.error(errorMessage(e))
              }
            }}
          >
            Выпустить ключ
          </Button>
        </Space>
        <Table<ApiKeyRead>
          rowKey="id"
          size="small"
          loading={keys.isLoading}
          dataSource={keys.data}
          pagination={false}
          columns={[
            { title: 'Название', dataIndex: 'name' },
            { title: 'Префикс', dataIndex: 'prefix', render: (p) => <Typography.Text code>ukapi_{p}_…</Typography.Text> },
            { title: 'Создан', dataIndex: 'created_at', render: dateTime },
            { title: 'Использован', dataIndex: 'last_used_at', render: dateTime },
            { title: 'Статус', dataIndex: 'is_active', render: (a) => (a ? <Tag color="green">активен</Tag> : <Tag>отозван</Tag>) },
            {
              key: 'revoke',
              render: (_, k) =>
                k.is_active && (
                  <Popconfirm
                    title="Отозвать ключ? Интеграция перестанет работать."
                    onConfirm={async () => {
                      await revokeKey.mutateAsync({ params: { path: { key_id: k.id } } })
                      await refresh('/api/v1/integrations/api-keys')
                    }}
                  >
                    <Button size="small" danger>Отозвать</Button>
                  </Popconfirm>
                ),
            },
          ]}
        />
      </Card>

      <Card
        title={<Space><ApiOutlined />Опрос внешних систем (pull)</Space>}
        extra={<Button icon={<PlusOutlined />} onClick={() => { form.resetFields(); setSourceModal(true) }}>Источник</Button>}
      >
        <Typography.Paragraph type="secondary">
          Сервер периодически запрашивает <Typography.Text code>GET url?since=…</Typography.Text> и ожидает ответ{' '}
          <Typography.Text code>{'{"readings": [...]}'}</Typography.Text> в том же формате, что и входящий API.
        </Typography.Paragraph>
        <Table<DataSourceRead>
          rowKey="id"
          size="small"
          loading={sources.isLoading}
          dataSource={sources.data}
          pagination={false}
          scroll={{ x: 800 }}
          columns={[
            { title: 'Название', dataIndex: 'name' },
            { title: 'URL', dataIndex: 'url', ellipsis: true },
            { title: 'Последний опрос', dataIndex: 'last_synced_at', render: dateTime },
            {
              title: 'Результат',
              render: (_, s) =>
                s.last_status ? (
                  <Space direction="vertical" size={0}>
                    <Tag color={s.last_status === 'ok' ? 'green' : s.last_status === 'partial' ? 'orange' : 'red'}>{s.last_status}</Tag>
                    {s.last_error && <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis={{ tooltip: s.last_error }}>{s.last_error}</Typography.Text>}
                  </Space>
                ) : '—',
            },
            {
              title: 'Активен',
              dataIndex: 'is_active',
              render: (active, s) => (
                <Switch
                  checked={active}
                  size="small"
                  onChange={async (checked) => {
                    await updateSource.mutateAsync({ params: { path: { source_id: s.id } }, body: { is_active: checked } })
                    await refresh('/api/v1/integrations/sources')
                  }}
                />
              ),
            },
            {
              key: 'sync',
              render: (_, s) => (
                <Button
                  size="small"
                  icon={<SyncOutlined />}
                  loading={syncSource.isPending && syncSource.variables?.params.path.source_id === s.id}
                  onClick={async () => {
                    try {
                      const result = await syncSource.mutateAsync({ params: { path: { source_id: s.id } } })
                      if (result.status === 'error') message.error(result.error ?? 'Ошибка опроса')
                      else message.success(`Принято: ${result.report?.accepted ?? 0}, дублей: ${result.report?.duplicates ?? 0}, отклонено: ${result.report?.rejected.length ?? 0}`)
                      await refresh('/api/v1/integrations/sources')
                    } catch (e) {
                      message.error(errorMessage(e))
                    }
                  }}
                >
                  Опросить
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={sourceModal}
        title="Новый источник показаний"
        okText="Подключить"
        confirmLoading={createSource.isPending}
        onCancel={() => setSourceModal(false)}
        onOk={async () => {
          const values = await form.validateFields()
          try {
            await createSource.mutateAsync({ body: { ...values, auth_token: values.auth_token || undefined } })
            setSourceModal(false)
            await refresh('/api/v1/integrations/sources')
          } catch (e) {
            message.error(errorMessage(e))
          }
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Название" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="url" label="URL выгрузки" rules={[{ required: true, type: 'url' }]}><Input placeholder="https://askue.example.ru/api/readings" /></Form.Item>
          <Form.Item name="auth_token" label="Bearer-токен" extra="Хранится на сервере и не показывается после сохранения"><Input.Password /></Form.Item>
        </Form>
      </Modal>
    </>
  )
}
