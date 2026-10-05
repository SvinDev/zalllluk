import { ArrowRightOutlined, PlusOutlined, QrcodeOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Col, Empty, Flex, List, Row, Skeleton, Statistic, Tag, Typography } from 'antd'
import { useState } from 'react'
import { Link } from 'react-router'

import { api } from '@/api/client'
import type { ApartmentRead, MeterRead } from '@/api/types'
import { useAuth } from '@/auth/useAuth'
import { StatusTag } from '@/components/StatusTag'
import { SubmitReadingModal } from '@/components/SubmitReadingModal'
import { TicketCreateModal } from '@/components/TicketCreateModal'
import { date, dateTime, isDebt, money, period, quantity } from '@/lib/format'
import { invoiceStatuses, meterKindLabels, ticketStatuses } from '@/lib/labels'

function AccountCard({ apartment }: { apartment: ApartmentRead }) {
  const summary = api.useQuery('get', '/api/v1/billing/accounts/{apartment_id}', {
    params: { path: { apartment_id: apartment.id } },
  })
  const invoices = api.useQuery('get', '/api/v1/invoices', {
    params: { query: { apartment_id: apartment.id, limit: 1 } },
  })
  const last = invoices.data?.items[0]
  const balance = summary.data?.balance

  return (
    <Card
      title={`${apartment.building.address}, кв. ${apartment.number}`}
      extra={<Typography.Text type="secondary">л/с {apartment.account_number}</Typography.Text>}
    >
      <Skeleton loading={summary.isLoading} active paragraph={{ rows: 2 }}>
        <Statistic
          title={isDebt(balance) ? 'Задолженность' : 'Баланс'}
          value={money(Math.abs(Number(balance ?? 0)))}
          valueStyle={{ color: isDebt(balance) ? '#cf1322' : '#3f8600' }}
        />
        {last && (
          <Flex justify="space-between" align="center" wrap gap={8} style={{ marginTop: 16 }}>
            <div>
              <Typography.Text>Квитанция за {period(last.period)}: </Typography.Text>
              <Typography.Text strong>{money(last.total_due)}</Typography.Text>{' '}
              <StatusTag value={last.status} map={invoiceStatuses} />
              {last.due_date && (
                <div>
                  <Typography.Text type="secondary">оплатить до {date(last.due_date)}</Typography.Text>
                </div>
              )}
            </div>
            <Link to={`/invoices/${last.id}`}>
              <Button type="primary" icon={<QrcodeOutlined />}>
                {last.status === 'paid' ? 'Открыть' : 'Оплатить'}
              </Button>
            </Link>
          </Flex>
        )}
      </Skeleton>
    </Card>
  )
}

export default function ResidentHomePage() {
  const { user } = useAuth()
  const [meter, setMeter] = useState<MeterRead | null>(null)
  const [ticketOpen, setTicketOpen] = useState(false)
  const meters = api.useQuery('get', '/api/v1/meters', { params: { query: { is_active: true, limit: 100 } } })
  const tickets = api.useQuery('get', '/api/v1/tickets', { params: { query: { limit: 5 } } })
  const news = api.useQuery('get', '/api/v1/announcements', { params: { query: { limit: 3 } } })

  const apartments = user?.apartments ?? []
  const firstDay = new Date()
  firstDay.setDate(1)
  firstDay.setHours(0, 0, 0, 0)

  return (
    <>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        Здравствуйте, {user?.full_name.split(' ')[0]}!
      </Typography.Title>
      {apartments.length === 0 && (
        <Alert
          type="info"
          showIcon
          message="Ваша учётная запись ещё не привязана к помещению"
          description="Обратитесь в управляющую компанию — после привязки здесь появятся квитанции и счётчики."
          style={{ marginBottom: 16 }}
        />
      )}
      <Row gutter={[16, 16]}>
        {apartments.map((apartment) => (
          <Col xs={24} lg={12} key={apartment.id}>
            <AccountCard apartment={apartment} />
          </Col>
        ))}

        <Col xs={24} lg={12}>
          <Card title="Счётчики" extra={<Link to="/meters">Все <ArrowRightOutlined /></Link>}>
            <List
              loading={meters.isLoading}
              locale={{ emptyText: <Empty description="Счётчиков нет" /> }}
              dataSource={meters.data?.items ?? []}
              renderItem={(m) => {
                const fresh = m.last_reading && new Date(m.last_reading.taken_at) >= firstDay
                return (
                  <List.Item
                    actions={[
                      <Button key="submit" type={fresh ? 'default' : 'primary'} size="small" onClick={() => setMeter(m)}>
                        Передать
                      </Button>,
                    ]}
                  >
                    <List.Item.Meta
                      title={
                        <Flex gap={8} wrap>
                          {meterKindLabels[m.kind]}
                          {fresh ? <Tag color="green">передано</Tag> : <Tag color="orange">ждём показания</Tag>}
                        </Flex>
                      }
                      description={
                        m.last_reading
                          ? `№ ${m.serial_number} · ${quantity(m.last_reading.value, m.unit)} от ${dateTime(m.last_reading.taken_at)}`
                          : `№ ${m.serial_number}`
                      }
                    />
                  </List.Item>
                )
              }}
            />
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card
            title="Мои заявки"
            extra={
              <Button type="link" icon={<PlusOutlined />} onClick={() => setTicketOpen(true)}>
                Новая
              </Button>
            }
          >
            <List
              loading={tickets.isLoading}
              locale={{ emptyText: <Empty description="Заявок пока нет" /> }}
              dataSource={tickets.data?.items ?? []}
              renderItem={(t) => (
                <List.Item extra={<StatusTag value={t.status} map={ticketStatuses} />}>
                  <List.Item.Meta
                    title={<Link to={`/tickets/${t.id}`}>№{t.id} · {t.subject}</Link>}
                    description={dateTime(t.created_at)}
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title="Объявления" extra={<Link to="/announcements">Все <ArrowRightOutlined /></Link>}>
            <List
              loading={news.isLoading}
              locale={{ emptyText: <Empty description="Объявлений нет" /> }}
              dataSource={news.data?.items ?? []}
              renderItem={(a) => (
                <List.Item>
                  <List.Item.Meta
                    title={
                      <Flex gap={8} wrap>
                        {a.is_pinned && <Tag color="red">важно</Tag>}
                        {a.title}
                      </Flex>
                    }
                    description={
                      <Typography.Paragraph ellipsis={{ rows: 2 }} type="secondary" style={{ margin: 0 }}>
                        {a.body}
                      </Typography.Paragraph>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>
      <SubmitReadingModal meter={meter} onClose={() => setMeter(null)} />
      <TicketCreateModal open={ticketOpen} onClose={() => setTicketOpen(false)} />
    </>
  )
}
