import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
    { path: '/', redirect: '/timeline' },
    { path: '/timeline', name: 'Timeline', component: () => import('../views/TimelineEntry.vue') },
    { path: '/editor', name: 'DataEditor', component: () => import('../views/DataEditor.vue') },
    { path: '/damage', name: 'DamageCalc', component: () => import('../views/DamageCalcView.vue') }
]

const router = createRouter({
    history: createWebHashHistory(),
    routes
})

export default router