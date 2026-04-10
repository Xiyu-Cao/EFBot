import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
    { path: '/', redirect: '/timeline' },
    { path: '/timeline', name: 'Timeline', component: () => import('../views/TimelineEntry.vue') },
    { path: '/editor', name: 'DataEditor', component: () => import('../views/DataEditor.vue') },
    { path: '/simulator', name: 'Simulator', component: () => import('../views/SimulatorView.vue') },
    // TEMP DEBUG TOOL — SAFE TO DELETE AFTER DAMAGE VALIDATION
    { path: '/debug-calc', name: 'DamageDebugCalc', component: () => import('../debug-tools/damage-calculator/DamageDebugCalculator.vue') }
]

const router = createRouter({
    history: createWebHashHistory(),
    routes
})

export default router