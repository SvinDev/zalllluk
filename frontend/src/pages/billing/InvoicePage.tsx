import { PrinterOutlined, SendOutlined, StopOutlined } from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import { App, Button, Card, Col, Descriptions, Divider, Flex, Popconfirm, Row, Skeleton, Table, Typography } from 'antd'
import { QRCodeSVG } from 'qrcode.react'
import { useNavigate, useParams } from 'react-router'

import { api } from '@/api/client'
import { errorMessage } from '@/api/errors'
import type { InvoiceDetail } from '@/api/types'
import { ACCOUNTANTS, useAuth } from '@/auth/useAuth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/QueryError'
import { StatusTag } from '@/components/StatusTag'
import { date, money, period, quantity } from '@/lib/format'
import { basisLabels, invoiceStatuses } from '@/lib/labels'

type Line = InvoiceDetail['lines'][number]

export default function InvoicePage() {
  const id = Number(useParams().id)
  const { hasRole } = useAuth()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data, isLoading, error } = api.useQuery('get', '/api/v1/invoices/{invoice_id}', {
    params: { path: { invoice_id: id } },
  })
  const issue = api.useMutation('post', '/api/v1/invoices/{invoice_id}/issue')
  const cancel = api.useMutation('post', '/api/v1/invoices/{invoice_id}/cancel')

  if (isLoading) return <Skeleton active />
  if (error || !data) return <QueryError error={error} />

  const inv = data
  const canManage = hasRole(...ACCOUNTANTS)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['get', '/api/v1/invoices'] })
  const params = { params: { path: { invoice_id: id } } }

  return (
    <>
      <PageHeader
        title={`Квитанция за ${period(inv.period)}`}
        subtitle={<>№ {inv.number} · <StatusTag value={inv.status} map={invoiceStatuses} /></>}
        extra={
          <span className="no-print">
            <Flex gap={8} wrap>
              <Button icon={<PrinterOutlined />} onClick={() => window.print()}>Печать</Button>
              {canManage && inv.status === 'draft' && (
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  loading={issue.isPending}
                  onClick={async () => {
                    try {
                      await issue.mutateAsync(params)
                      await refresh()
                    } catch (e) {
                      message.error(errorMessage(e))
                    }
                  }}
                >
                  Выставить
                </Button>
              )}
              {canManage && inv.status !== 'cancelled' && (
                <Popconfirm
                  title={inv.status === 'draft' ? 'Удалить черновик?' : 'Аннулировать квитанцию? Оплаты будут перераспределены.'}
                  onConfirm={async () => {
                    try {
                      await cancel.mutateAsync(params)
                      await refresh()
                      if (inv.status === 'draft') navigate('/invoices')
                    } catch (e) {
                      message.error(errorMessage(e))
                    }
                  }}
                >
                  <Button danger icon={<StopOutlined />}>{inv.status === 'draft' ? 'Удалить' : 'Аннулировать'}</Button>
                </Popconfirm>
              )}
            </Flex>
          </span>
        }
      />
      <Card className="receipt">
        <Row gutter={24}>
          <Col xs={24} md={16}>
            <Typography.Title level={5} style={{ marginTop: 0 }}>Получатель платежа</Typography.Title>
            <Descriptions size="small" column={1}>
              <Descriptions.Item label="Организация">{inv.payee.name}</Descriptions.Item>
              <Descriptions.Item label="ИНН / КПП">{inv.payee.inn} / {inv.payee.kpp}</Descriptions.Item>
              <Descriptions.Item label="Р/с">{inv.payee.bank_account}</Descriptions.Item>
              <Descriptions.Item label="Банк">{inv.payee.bank_name}, БИК {inv.payee.bik}, к/с {inv.payee.corr_account}</Descriptions.Item>
              {inv.payee.phone && <Descriptions.Item label="Телефон">{inv.payee.phone}</Descriptions.Item>}
            </Descriptions>
            <Divider style={{ margin: '12px 0' }} />
            <Typography.Title level={5}>Плательщик</Typography.Title>
            <Descriptions size="small" column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label="Лицевой счёт"><strong>{inv.apartment.account_number}</strong></Descriptions.Item>
              <Descriptions.Item label="Собственник">{inv.apartment.owner_name ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Адрес">{inv.apartment.building.address}, кв. {inv.apartment.number}</Descriptions.Item>
              <Descriptions.Item label="Площадь / проживает">{quantity(inv.apartment.area, 'м²')} / {inv.apartment.residents_count} чел.</Descriptions.Item>
            </Descriptions>
          </Col>
          <Col xs={24} md={8}>
            <Flex vertical align="center" gap={8} style={{ padding: 12, border: '1px dashed #d9d9d9', borderRadius: 8 }}>
              <Typography.Text type="secondary">Итого к оплате</Typography.Text>
              <Typography.Title level={2} style={{ margin: 0 }}>{money(inv.total_due)}</Typography.Title>
              {inv.due_date && <Typography.Text>до {date(inv.due_date)}</Typography.Text>}
              {inv.payment_qr ? (
                <>
                  <QRCodeSVG value={inv.payment_qr} size={180} level="M" marginSize={2} />
                  <Typography.Text type="secondary" style={{ fontSize: 12, textAlign: 'center' }}>
                    Отсканируйте в приложении банка — реквизиты и сумма заполнятся автоматически
                  </Typography.Text>
                </>
              ) : inv.status === 'draft' ? (
                <Typography.Text type="warning">Черновик — ещё не выставлена</Typography.Text>
              ) : inv.status === 'paid' ? (
                <Typography.Text type="success" strong>Квитанция оплачена</Typography.Text>
              ) : null}
            </Flex>
          </Col>
        </Row>

        <Table<Line>
          style={{ marginTop: 24 }}
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={inv.lines}
          scroll={{ x: 760 }}
          columns={[
            {
              title: 'Услуга',
              dataIndex: 'service_name',
              render: (name, l) => (
                <>
                  {name}
                  {(l.details || basisLabels[l.basis]) && (
                    <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                      {l.details ?? basisLabels[l.basis]}
                    </Typography.Text>
                  )}
                </>
              ),
            },
            {
              title: 'Показания',
              render: (_, l) => (l.reading_from !== null && l.reading_to !== null ? `${quantity(l.reading_from)} → ${quantity(l.reading_to)}` : ''),
            },
            { title: 'Объём', dataIndex: 'quantity', align: 'right', render: (q, l) => quantity(q, l.unit) },
            { title: 'Тариф', dataIndex: 'rate', align: 'right', render: (r) => money(r) },
            { title: 'Сумма', dataIndex: 'amount', align: 'right', render: money },
          ]}
          summary={() => (
            <>
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={4}>Начислено за {period(inv.period)}</Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right"><strong>{money(inv.amount)}</strong></Table.Summary.Cell>
              </Table.Summary.Row>
              {Number(inv.opening_balance) !== 0 && (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={4}>
                    {Number(inv.opening_balance) > 0 ? 'Задолженность на начало периода' : 'Аванс на начало периода'}
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">{money(inv.opening_balance)}</Table.Summary.Cell>
                </Table.Summary.Row>
              )}
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={4}><strong>Итого к оплате</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right"><strong>{money(inv.total_due)}</strong></Table.Summary.Cell>
              </Table.Summary.Row>
            </>
          )}
        />
        {Number(inv.paid_amount) > 0 && (
          <Typography.Paragraph type="success" style={{ marginTop: 12 }}>
            Зачтено оплат по этой квитанции: {money(inv.paid_amount)}
          </Typography.Paragraph>
        )}
      </Card>
    </>
  )
}
