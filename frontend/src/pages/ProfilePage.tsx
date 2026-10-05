import { App, Button, Card, Col, Descriptions, Form, Input, Row } from 'antd'

import { api } from '@/api/client'
import { errorMessage } from '@/api/errors'
import { useAuth } from '@/auth/useAuth'
import { PageHeader } from '@/components/PageHeader'
import { roleLabels } from '@/lib/labels'

type Values = { current_password: string; new_password: string; confirm: string }

export default function ProfilePage() {
  const { user } = useAuth()
  const { message } = App.useApp()
  const [form] = Form.useForm<Values>()
  const change = api.useMutation('post', '/api/v1/auth/change-password')
  if (!user) return null

  return (
    <>
      <PageHeader title="Профиль" />
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="Учётная запись">
            <Descriptions column={1}>
              <Descriptions.Item label="ФИО">{user.full_name}</Descriptions.Item>
              <Descriptions.Item label="Email">{user.email}</Descriptions.Item>
              <Descriptions.Item label="Телефон">{user.phone ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Роль">{roleLabels[user.role]}</Descriptions.Item>
              {user.apartments.map((a) => (
                <Descriptions.Item key={a.id} label="Помещение">
                  {a.building.address}, кв. {a.number} (л/с {a.account_number})
                </Descriptions.Item>
              ))}
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Смена пароля">
            <Form
              form={form}
              layout="vertical"
              onFinish={async ({ current_password, new_password }) => {
                try {
                  await change.mutateAsync({ body: { current_password, new_password } })
                  message.success('Пароль изменён')
                  form.resetFields()
                } catch (e) {
                  message.error(errorMessage(e))
                }
              }}
            >
              <Form.Item name="current_password" label="Текущий пароль" rules={[{ required: true }]}>
                <Input.Password autoComplete="current-password" />
              </Form.Item>
              <Form.Item name="new_password" label="Новый пароль" rules={[{ required: true, min: 8, message: 'Минимум 8 символов' }]}>
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item
                name="confirm"
                label="Повторите пароль"
                dependencies={['new_password']}
                rules={[
                  { required: true },
                  ({ getFieldValue }) => ({
                    validator: (_, value) =>
                      !value || getFieldValue('new_password') === value ? Promise.resolve() : Promise.reject(new Error('Пароли не совпадают')),
                  }),
                ]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={change.isPending}>Сменить пароль</Button>
            </Form>
          </Card>
        </Col>
      </Row>
    </>
  )
}
