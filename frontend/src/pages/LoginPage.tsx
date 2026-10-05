import { LockOutlined, LoginOutlined, MailOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Divider, Flex, Form, Input, List, Typography } from 'antd'
import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'

import { useAuth } from '@/auth/useAuth'
import { DEMO_ACCOUNTS, DEMO_PASSWORD, IS_DEMO } from '@/demo/accounts'
import { roleLabels } from '@/lib/labels'

type Values = { email: string; password: string }

export function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (user) return <Navigate to="/" replace />

  const onFinish = async ({ email, password }: Values) => {
    setSubmitting(true)
    setError(null)
    try {
      await login(email, password)
      const from = (location.state as { from?: string } | null)?.from
      navigate(from && from !== '/login' ? from : '/', { replace: true })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Flex
      justify="center"
      align="center"
      style={{ minHeight: '100vh', padding: 16, background: 'linear-gradient(135deg,#e6f0ff,#f5f7fa)' }}
    >
      <Card style={{ width: '100%', maxWidth: 400 }}>
        <Flex vertical align="center" gap={4} style={{ marginBottom: 24 }}>
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} width={48} height={48} alt="" />
          <Typography.Title level={3} style={{ margin: '8px 0 0' }}>
            УК Онлайн
          </Typography.Title>
          <Typography.Text type="secondary">Личный кабинет жителя и сотрудника УК</Typography.Text>
        </Flex>
        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
        <Form<Values> layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email', message: 'Введите email' }]}>
            <Input prefix={<MailOutlined />} autoComplete="username" size="large" autoFocus />
          </Form.Item>
          <Form.Item name="password" label="Пароль" rules={[{ required: true, message: 'Введите пароль' }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" size="large" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
            Войти
          </Button>
        </Form>
        {IS_DEMO && (
          <>
            <Divider plain>Демо: войти одним кликом</Divider>
            <List
              size="small"
              dataSource={DEMO_ACCOUNTS}
              renderItem={(account) => (
                <List.Item
                  actions={[
                    <Button
                      key="login"
                      size="small"
                      icon={<LoginOutlined />}
                      disabled={submitting}
                      onClick={() => onFinish({ email: account.email, password: DEMO_PASSWORD })}
                    >
                      Войти
                    </Button>,
                  ]}
                >
                  <List.Item.Meta title={roleLabels[account.role]} description={account.hint} />
                </List.Item>
              )}
            />
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
              Демо работает без сервера: API эмулируется в браузере, изменения видны только вам.
            </Typography.Paragraph>
          </>
        )}
      </Card>
    </Flex>
  )
}
