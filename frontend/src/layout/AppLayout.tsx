import { LogoutOutlined, MenuOutlined, ReloadOutlined, UserOutlined } from '@ant-design/icons'
import {
  Avatar,
  Button,
  Drawer,
  Dropdown,
  Flex,
  Grid,
  Layout,
  Menu,
  Popconfirm,
  Spin,
  Tag,
  Typography,
  theme,
  type MenuProps,
} from 'antd'
import { Suspense, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'

import { useAuth } from '@/auth/useAuth'
import { IS_DEMO } from '@/demo/accounts'
import { roleLabels } from '@/lib/labels'

import { navigation } from './navigation'

const { Header, Sider, Content } = Layout

export function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const screens = Grid.useBreakpoint()
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  // До первого замера брейкпоинтов считаем экран широким, чтобы не мигало меню.
  const isMobile = screens.lg === false
  const { token } = theme.useToken()

  const items = useMemo<MenuProps['items']>(() => {
    if (!user) return []
    return navigation.flatMap((group): NonNullable<MenuProps['items']> => {
      const visible = group.items
        .filter((item) => item.roles.includes(user.role))
        .map((item) => ({ key: item.path, icon: item.icon, label: item.label }))
      if (!visible.length) return []
      return group.label
        ? [{ type: 'group' as const, key: group.label, label: group.label, children: visible }]
        : visible
    })
  }, [user])

  // Подсветка пункта меню и для вложенных страниц (/tickets/42 → /tickets).
  const selected = '/' + (location.pathname.split('/')[1] ?? '')

  const userMenu: MenuProps['items'] = [
    { key: 'profile', icon: <UserOutlined />, label: 'Профиль', onClick: () => navigate('/profile') },
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Выйти', danger: true, onClick: logout },
  ]

  const menu = (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={[selected]}
      items={items}
      onClick={({ key }) => {
        navigate(key)
        setDrawerOpen(false)
      }}
    />
  )

  const logo = (compact: boolean) => (
    <Flex align="center" gap={10} style={{ height: 64, padding: '0 20px' }}>
      <img src={`${import.meta.env.BASE_URL}favicon.svg`} width={28} height={28} alt="" />
      {!compact && (
        <Typography.Text strong style={{ color: '#fff', fontSize: 16, whiteSpace: 'nowrap' }}>
          УК Онлайн
        </Typography.Text>
      )}
    </Flex>
  )

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {isMobile ? (
        <Drawer
          placement="left"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          width={260}
          closable={false}
          styles={{ body: { padding: 0, background: '#001529' } }}
        >
          {logo(false)}
          {menu}
        </Drawer>
      ) : (
        <Sider
          className="no-print"
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          width={232}
          style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'auto' }}
        >
          {logo(collapsed)}
          {menu}
        </Sider>
      )}
      <Layout>
        <Header
          className="no-print"
          style={{
            background: token.colorBgContainer,
            padding: isMobile ? '0 12px' : '0 24px',
            display: 'flex',
            justifyContent: isMobile || IS_DEMO ? 'space-between' : 'flex-end',
            alignItems: 'center',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          {isMobile && <Button type="text" icon={<MenuOutlined />} onClick={() => setDrawerOpen(true)} aria-label="Меню" />}
          {IS_DEMO && (
            <Flex align="center" gap={8} style={{ marginRight: 'auto', marginLeft: isMobile ? 8 : 0 }}>
              <Tag color="purple" style={{ marginInlineEnd: 0 }}>Демо</Tag>
              {!isMobile && (
                <Popconfirm
                  title="Вернуть демо-данные к исходным?"
                  onConfirm={async () => {
                    const { resetDemo } = await import('@/demo/store')
                    resetDemo()
                    logout()
                  }}
                >
                  <Button size="small" type="link" icon={<ReloadOutlined />}>Сбросить данные</Button>
                </Popconfirm>
              )}
            </Flex>
          )}
          {user && (
            <Dropdown menu={{ items: userMenu }} placement="bottomRight">
              <Flex align="center" gap={10} style={{ cursor: 'pointer' }}>
                <Avatar icon={<UserOutlined />} style={{ background: token.colorPrimary }} />
                <Flex vertical style={{ lineHeight: 1.2 }}>
                  <Typography.Text strong>{user.full_name}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {roleLabels[user.role]}
                  </Typography.Text>
                </Flex>
              </Flex>
            </Dropdown>
          )}
        </Header>
        <Content style={{ padding: screens.md ? 24 : 12 }}>
          <Suspense fallback={<Spin size="large" style={{ display: 'block', marginTop: 120 }} />}>
            <Outlet />
          </Suspense>
        </Content>
      </Layout>
    </Layout>
  )
}
