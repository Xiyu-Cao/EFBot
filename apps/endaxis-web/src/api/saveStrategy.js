import { ElMessage } from 'element-plus'

export async function executeSave(dataToSave) {
    try {
        const jsonData = JSON.stringify(dataToSave, null, 2)
        const blob = new Blob([jsonData], { type: 'application/json' })
        const link = document.createElement('a')
        link.href = URL.createObjectURL(blob)
        link.download = 'gamedata.json'
        link.click()
        URL.revokeObjectURL(link.href)

        ElMessage.success('gamedata.json 已生成，请覆盖项目文件')
    } catch (e) {
        console.error(e)
        ElMessage.error('导出失败')
    }
}