import { App, Form, Input, Modal, Select } from 'antd'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'

import { api } from '@/api/client'
import { errorMessage } from '@/api/errors'
import type { TicketCategory, TicketPriority } from '@/api/types'
import { useAuth } from '@/auth/useAuth'
import { options, ticketCategoryLabels, ticketPriorities } from '@/lib/labels'

import { ApartmentSelect, BuildingSelect } from './selects'

type Values = {
  apartment_id?: number
  building_id?: number
  category: TicketCategory
  priority: TicketPriority
  subject: string
  description: string
}

export function TicketCreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<Values>()
  const { user } = useAuth()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const create = api.useMutation('post', '/api/v1/tickets')
  const isResident = user?.role === 'resident'
  const apartments = user?.apartments ?? []

  const onOk = async () => {
    const values = await form.validateFields()
    try {
      const ticket = await create.mutateAsync({ body: values })
      message.success(`Заявка №${ticket.id} создана`)
      await queryClient.invalidateQueries({ queryKey: ['get', '/api/v1/tickets'] })
      form.resetFields()
      onClose()
      navigate(`/tickets/${ticket.id}`)
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  return (
    <Modal
      open={open}
      title="Новая заявка"
      okText="Отправить"
      onOk={onOk}
      onCancel={onClose}
      confirmLoading={create.isPending}
      destroyOnHidden
      width={600}
    >
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{
          priority: 'normal',
          apartment_id: isResident && apartments.length === 1 ? apartments[0].id : undefined,
        }}
      >
        {isResident ? (
          <Form.Item name="apartment_id" label="Помещение" rules={[{ required: true, message: 'Выберите помещение' }]}>
            <Select
              options={apartments.map((a) => ({
                value: a.id,
                label: `${a.building.address}, кв. ${a.number}`,
              }))}
            />
          </Form.Item>
        ) : (
          <>
            <Form.Item name="apartment_id" label="Помещение" extra="Оставьте пустым для общедомовой заявки">
              <ApartmentSelect />
            </Form.Item>
            <Form.Item noStyle dependencies={['apartment_id']}>
              {({ getFieldValue }) =>
                !getFieldValue('apartment_id') && (
                  <Form.Item name="building_id" label="Дом" rules={[{ required: true, message: 'Укажите дом' }]}>
                    <BuildingSelect />
                  </Form.Item>
                )
              }
            </Form.Item>
          </>
        )}
        <Form.Item name="category" label="Категория" rules={[{ required: true, message: 'Выберите категорию' }]}>
          <Select options={options(ticketCategoryLabels)} />
        </Form.Item>
        <Form.Item name="priority" label="Срочность">
          <Select options={options(ticketPriorities)} />
        </Form.Item>
        <Form.Item name="subject" label="Кратко" rules={[{ required: true, min: 3, message: 'Минимум 3 символа' }]}>
          <Input maxLength={255} placeholder="Например: течёт кран на кухне" />
        </Form.Item>
        <Form.Item name="description" label="Подробности" rules={[{ required: true, message: 'Опишите проблему' }]}>
          <Input.TextArea rows={4} maxLength={10000} showCount />
        </Form.Item>
      </Form>
    </Modal>
  )
}
