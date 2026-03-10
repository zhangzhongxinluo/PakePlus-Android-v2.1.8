
        // ==================== 全局状态 ====================
        let mindmapData = null;                 // 树形数据
        let selectedNode = null;                // 当前选中节点 (包含布局信息)
        let scale = 1;
        // 拖拽状态 (同时支持鼠标和触摸)
        let isDragging = false;
        let startX, startY, scrollLeft, scrollTop;
        let nodeIdCounter = 0;
        let nodeMap = new Map();                 // id -> 布局节点
        let hasUnsavedChanges = false;
        let currentHistoryId = null;
        let isControlsCollapsed = false;
        let currentTheme = 1;

        // 布局常量
        const MAX_NODE_WIDTH = 600;              // 足够宽，不自动换行
        const MIN_NODE_WIDTH = 120;
        const LINE_HEIGHT = 24;                   // 每行高度
        const PADDING_X = 32;
        const PADDING_Y = 32;
        const LEVEL_GAP = 340;                    // 层级间距
        const SIBLING_GAP = 16;

        const STORAGE_KEY = 'mindmap_history_v6';
        const THEME_KEY = 'mindmap_theme_v6';

        // ==================== 初始化 ====================
        document.addEventListener('DOMContentLoaded', () => {
            setupEventListeners();
            loadControlsState();
            loadTheme();
            // 移动端：如果屏幕较小且未保存折叠状态，默认折叠控制面板
            if (window.innerWidth <= 600 && localStorage.getItem('mindmap_controls_collapsed') === null) {
                isControlsCollapsed = true;
                document.getElementById('controlsWrapper').classList.add('collapsed');
                localStorage.setItem('mindmap_controls_collapsed', 'true');
            }
            const parseArea = document.getElementById('parseTextarea');
            parseArea.addEventListener('paste', handlePastePreserveIndent);
        });

        // 粘贴保留缩进
        function handlePastePreserveIndent(e) {
            e.preventDefault();
            let pasteText = (e.clipboardData || window.clipboardData).getData('text/plain');
            if (!pasteText) return;
            const target = e.target;
            const start = target.selectionStart;
            const end = target.selectionEnd;
            const currentValue = target.value;
            target.value = currentValue.substring(0, start) + pasteText + currentValue.substring(end);
            target.selectionStart = target.selectionEnd = start + pasteText.length;
            target.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // 导入 .txt 文件
        function importTxtFile(event) {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                document.getElementById('parseTextarea').value = e.target.result;
                showToast('文本已加载');
            };
            reader.readAsText(file, 'UTF-8');
        }

        // ==================== 主题切换 ====================
        function switchTheme(themeNum) {
            currentTheme = themeNum;
            document.body.className = `theme-${themeNum}`;
            document.querySelectorAll('.theme-option').forEach(el => {
                el.classList.remove('active');
                if (parseInt(el.dataset.theme) === themeNum) el.classList.add('active');
            });
            localStorage.setItem(THEME_KEY, themeNum);
            if (mindmapData) renderMindmap(mindmapData);
            showToast('主题已切换');
        }
        function loadTheme() { const saved = localStorage.getItem(THEME_KEY); if (saved) switchTheme(parseInt(saved)); }

        function toggleControls() {
            const wrapper = document.getElementById('controlsWrapper');
            isControlsCollapsed = !isControlsCollapsed;
            wrapper.classList.toggle('collapsed', isControlsCollapsed);
            localStorage.setItem('mindmap_controls_collapsed', isControlsCollapsed);
        }
        function loadControlsState() {
            const saved = localStorage.getItem('mindmap_controls_collapsed');
            if (saved === 'true') {
                isControlsCollapsed = true;
                document.getElementById('controlsWrapper').classList.add('collapsed');
            }
        }

        // 事件监听 (增加触摸支持)
        function setupEventListeners() {
            const container = document.getElementById('canvas-container');
            // 鼠标事件
            container.addEventListener('mousedown', handleDragStart);
            container.addEventListener('mouseleave', handleDragEnd);
            container.addEventListener('mouseup', handleDragEnd);
            container.addEventListener('mousemove', handleDragMove);
            // 触摸事件
            container.addEventListener('touchstart', handleTouchStart, { passive: false });
            container.addEventListener('touchmove', handleTouchMove, { passive: false });
            container.addEventListener('touchend', handleTouchEnd);
            container.addEventListener('touchcancel', handleTouchEnd);

            container.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); e.deltaY < 0 ? zoomIn() : zoomOut(); } }, { passive: false });

            document.addEventListener('keydown', (e) => {
                if (document.getElementById('editPanel').classList.contains('active')) {
                    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); saveNode(); }
                    else if (e.key === 'Escape') closeAllPanels();
                    return;
                }
                if (e.key === 'Delete' && selectedNode && selectedNode.depth !== 0) deleteNode();
                if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveToHistory(); }
            });

            window.addEventListener('beforeunload', (e) => { if (hasUnsavedChanges) { e.preventDefault(); e.returnValue = '有未保存的更改'; } });
        }

        // 鼠标拖动
        function handleDragStart(e) { if (e.button !== 0 || e.target.closest('.node')) return; isDragging = true; startX = e.pageX; startY = e.pageY; const c = document.getElementById('canvas-container'); scrollLeft = c.scrollLeft; scrollTop = c.scrollTop; }
        function handleDragEnd() { isDragging = false; }
        function handleDragMove(e) { if (!isDragging) return; e.preventDefault(); const walkX = (e.pageX - startX) * 1.5; const walkY = (e.pageY - startY) * 1.5; const c = document.getElementById('canvas-container'); c.scrollLeft = scrollLeft - walkX; c.scrollTop = scrollTop - walkY; }

        // 触摸拖动
        function handleTouchStart(e) {
            if (e.touches.length !== 1) return;
            if (e.target.closest('.node')) return; // 节点上不触发画布拖拽，保留节点滚动
            e.preventDefault();
            isDragging = true;
            const touch = e.touches[0];
            startX = touch.pageX;
            startY = touch.pageY;
            const c = document.getElementById('canvas-container');
            scrollLeft = c.scrollLeft;
            scrollTop = c.scrollTop;
        }
        function handleTouchMove(e) {
            if (!isDragging || e.touches.length !== 1) return;
            e.preventDefault();
            const touch = e.touches[0];
            const walkX = (touch.pageX - startX) * 1.5;
            const walkY = (touch.pageY - startY) * 1.5;
            const c = document.getElementById('canvas-container');
            c.scrollLeft = scrollLeft - walkX;
            c.scrollTop = scrollTop - walkY;
        }
        function handleTouchEnd(e) {
            if (isDragging) { e.preventDefault(); isDragging = false; }
        }

        // ==================== 智能文本解析 ====================
        function parseTextToJSON(text) {
            if (!text.trim()) return null;
            const lines = text.split('\n').filter(l => l.trim());
            if (lines.length === 0) return null;
            const parsedLines = lines.map(line => { const info = analyzeLine(line); return { original: line, level: info.level, text: info.text, isValid: info.isValid }; }).filter(item => item.isValid);
            if (parsedLines.length === 0) return null;
            const root = { name: parsedLines[0].text, children: [] };
            const stack = [{ node: root, level: parsedLines[0].level }];
            for (let i = 1; i < parsedLines.length; i++) {
                const current = parsedLines[i];
                const newNode = { name: current.text, children: [] };
                while (stack.length > 0 && stack[stack.length - 1].level >= current.level) stack.pop();
                if (stack.length > 0) { const parent = stack[stack.length - 1].node; parent.children = parent.children || []; parent.children.push(newNode); stack.push({ node: newNode, level: current.level }); } 
                else { root.children.push(newNode); stack.push({ node: newNode, level: current.level }); }
            }
            return root;
        }

        function analyzeLine(line) {
            const trimmed = line.trim(); if (!trimmed) return { level:0, text:'', isValid:false };
            let level = 0, text = trimmed;
            const leadingSpace = line.match(/^(\s*)/)[1];
            const indentLevel = Math.floor(leadingSpace.replace(/\t/g, '  ').length / 2);
            const chineseNumMatch = trimmed.match(/^([一二三四五六七八九十百千万]+)[、.．]\s*(.+)$/);
            if (chineseNumMatch) { level = indentLevel + 1; text = chineseNumMatch[2]; return { level, text, isValid: true }; }
            const arabicMatch = trimmed.match(/^(\d+(?:\.\d+)*)\.?\s+(.+)$/);
            if (arabicMatch) { const parts = arabicMatch[1].split('.'); level = indentLevel + parts.length; text = arabicMatch[2]; return { level, text, isValid: true }; }
            const bulletMatch = trimmed.match(/^[-•*·]\s+(.+)$/);
            if (bulletMatch) { level = indentLevel + 3; text = bulletMatch[1]; return { level, text, isValid: true }; }
            if (indentLevel > 0) { level = indentLevel + 1; text = trimmed; return { level, text, isValid: true }; }
            return { level: 0, text: trimmed, isValid: true };
        }

        function openTextParser() { document.getElementById('textParsePanel').classList.add('active'); document.getElementById('panelOverlay').classList.add('active'); document.getElementById('parseTextarea').focus(); }
        function loadParseExample() { document.getElementById('parseTextarea').value = `一、项目规划\n  1. 需求分析\n    - 用户调研\n    - 竞品分析\n  2. 技术方案\n    - 架构设计\n    - 接口定义`; showToast('示例已加载'); }
        function clearParseText() { if (confirm('清空文本？')) { document.getElementById('parseTextarea').value = ''; } }
        function parseAndGenerate() {
            const text = document.getElementById('parseTextarea').value;
            if (!text.trim()) { showToast('请输入内容'); return; }
            const result = parseTextToJSON(text);
            if (!result) { alert('无法解析，请检查格式'); return; }
            mindmapData = result;
            renderMindmap(mindmapData);
            currentHistoryId = null;
            markUnsaved();
            closeAllPanels();
            showToast('生成成功');
        }

        // ==================== 布局计算 (与原有保持一致，仅保留关键函数) ====================
        function calculateTextDimensions(text, depth) {
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            let fontSize = depth === 0 ? 22 : (depth === 1 ? 16 : 14);
            let fontWeight = (depth === 0 || depth === 1) ? 'bold' : '500';
            context.font = `${fontWeight} ${fontSize}px 'Microsoft YaHei', 'PingFang SC', 'SimHei', sans-serif`;

            const manualLines = text.split('\n');
            let maxLineWidth = 0;
            manualLines.forEach(line => {
                const metrics = context.measureText(line);
                maxLineWidth = Math.max(maxLineWidth, metrics.width);
            });

            const width = Math.max(MIN_NODE_WIDTH, maxLineWidth + PADDING_X);
            const lineCount = manualLines.length;
            const height = Math.max(48, lineCount * LINE_HEIGHT + PADDING_Y);
            return { width, height, lines: lineCount };
        }

        function calculateLayout(data) {
            nodeMap.clear(); nodeIdCounter = 0;
            function preprocess(node, depth = 0, parent = null) {
                const id = `node-${nodeIdCounter++}`;
                const dims = calculateTextDimensions(node.name, depth);
                const processed = {
                    id, data: node, depth, parent, children: [],
                    width: dims.width, height: dims.height,
                    x: 0, y: 0, subtreeHeight: 0
                };
                nodeMap.set(id, processed);
                if (node.children) node.children.forEach(child => processed.children.push(preprocess(child, depth + 1, processed)));
                return processed;
            }
            const root = preprocess(data);

            function calcSubtreeHeight(node) {
                if (node.children.length === 0) { node.subtreeHeight = node.height + SIBLING_GAP*2; return node.subtreeHeight; }
                let total = 0;
                node.children.forEach(child => total += calcSubtreeHeight(child));
                node.subtreeHeight = Math.max(total, node.height + SIBLING_GAP*2);
                return node.subtreeHeight;
            }
            calcSubtreeHeight(root);

            function calcPosition(node, startY = 0) {
                node.x = node.depth * LEVEL_GAP + 50;
                if (node.children.length === 0) { node.y = startY + node.height / 2; return startY + node.subtreeHeight; }
                let currentY = startY;
                node.children.forEach(child => currentY = calcPosition(child, currentY));
                const first = node.children[0], last = node.children[node.children.length-1];
                node.y = (first.y + last.y) / 2;
                return currentY;
            }
            calcPosition(root);
            return root;
        }

        // ==================== 渲染 ====================
        function renderMindmap(data) {
            mindmapData = data;
            const canvasDiv = document.getElementById('mindmap-canvas');
            document.getElementById('emptyState')?.remove();
            canvasDiv.innerHTML = '';

            const root = calculateLayout(data);
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:1;';
            canvasDiv.appendChild(svg);

            let maxX = 0, maxY = 0, nodeCount = 0, maxDepth = 0;

            function renderNode(node) {
                nodeCount++; maxDepth = Math.max(maxDepth, node.depth);
                const el = document.createElement('div');
                el.className = `node level-${Math.min(node.depth,6)}`;
                if (node.depth === 0) el.classList.add('root');
                el.id = node.id;
                el.style.cssText = `left:${node.x}px; top:${node.y - node.height/2}px; width:${node.width}px; min-height:${node.height}px;`;
                const content = document.createElement('div');
                content.className = 'node-content';
                content.textContent = node.data.name;
                el.appendChild(content);

                el.addEventListener('click', (e) => { e.stopPropagation(); selectNode(node); });
                el.addEventListener('dblclick', (e) => { e.stopPropagation(); editNode(node); });

                canvasDiv.appendChild(el);

                maxX = Math.max(maxX, node.x + node.width + 100);
                maxY = Math.max(maxY, node.y + node.height/2 + 100);

                node.children.forEach(child => { drawSvgConnection(svg, node, child); renderNode(child); });
            }
            renderNode(root);

            canvasDiv.style.width = svg.style.width = `${Math.max(maxX, window.innerWidth)}px`;
            canvasDiv.style.height = svg.style.height = `${Math.max(maxY, window.innerHeight)}px`;

            document.getElementById('stats').textContent = `节点: ${nodeCount} | 层级: ${maxDepth + 1}`;
            const container = document.getElementById('canvas-container');
            container.scrollLeft = 0;
            container.scrollTop = Math.max(0, root.y - container.clientHeight / 3);
        }

        function drawSvgConnection(svg, parent, child) {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            const sx = parent.x + parent.width, sy = parent.y;
            const ex = child.x, ey = child.y;
            const dx = ex - sx;
            let d;
            if (currentTheme === 2) {
                const midX = sx + dx/2;
                d = `M ${sx} ${sy} L ${midX} ${sy} L ${midX} ${ey} L ${ex} ${ey}`;
                path.setAttribute('stroke', '#64748b'); path.setAttribute('stroke-width', '1.5');
                if (parent.depth >= 1) path.setAttribute('stroke-dasharray', '4,4');
            } else if (currentTheme === 3) {
                d = `M ${sx} ${sy} C ${sx + dx/2} ${sy}, ${ex - dx/2} ${ey}, ${ex} ${ey}`;
                path.setAttribute('stroke', '#818cf8'); path.setAttribute('stroke-width', '2');
            } else {
                d = `M ${sx} ${sy} C ${sx + dx/2} ${sy}, ${ex - dx/2} ${ey}, ${ex} ${ey}`;
                path.setAttribute('stroke', '#cbd5e0'); path.setAttribute('stroke-width', '2');
            }
            path.setAttribute('d', d); path.setAttribute('fill', 'none');
            svg.appendChild(path);
        }

        // 节点操作
        function selectNode(node) { document.querySelectorAll('.node').forEach(el => el.classList.remove('selected')); document.getElementById(node.id)?.classList.add('selected'); selectedNode = node; document.getElementById('deleteBtn').disabled = false; }
        function editNode(node) { selectNode(node); document.getElementById('nodeText').value = node.data.name; document.getElementById('editPanel').classList.add('active'); document.getElementById('panelOverlay').classList.add('active'); }
        function saveNode() { if (!selectedNode) return; selectedNode.data.name = document.getElementById('nodeText').value; renderMindmap(mindmapData); closeAllPanels(); markUnsaved(); showToast('已保存'); }
        function addNode() { if (!selectedNode) { showToast('请先选择一个节点'); return; } const name = prompt('新节点名称:', '新节点'); if (!name) return; if (!selectedNode.data.children) selectedNode.data.children = []; selectedNode.data.children.push({ name }); renderMindmap(mindmapData); markUnsaved(); }
        function addSiblingNode() { if (!selectedNode || selectedNode.depth === 0) { showToast('请选择非根节点'); return; } const name = prompt('兄弟节点名称:', '兄弟节点'); if (!name) return; const parent = selectedNode.parent; if (parent?.data.children) { parent.data.children.push({ name }); renderMindmap(mindmapData); markUnsaved(); } }
        function deleteNode() { if (!selectedNode || selectedNode.depth === 0) { showToast('不能删除根节点'); return; } if (!confirm('删除此节点及所有子节点？')) return; const parent = selectedNode.parent; if (parent?.data.children) { parent.data.children = parent.data.children.filter(c => c !== selectedNode.data); renderMindmap(mindmapData); selectedNode = null; document.getElementById('deleteBtn').disabled = true; closeAllPanels(); markUnsaved(); showToast('已删除'); } }

        // ==================== 导出图片 (精简) ====================
        function exportImage() {
            if (!mindmapData || nodeMap.size === 0) { showToast('没有导图可导出'); return; }
            const nodes = Array.from(nodeMap.values());
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            nodes.forEach(node => {
                minX = Math.min(minX, node.x - node.width/2);
                minY = Math.min(minY, node.y - node.height/2);
                maxX = Math.max(maxX, node.x + node.width/2);
                maxY = Math.max(maxY, node.y + node.height/2);
            });

            const padding = 60;
            const width = maxX - minX + padding * 2;
            const height = maxY - minY + padding * 2;
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(800, width);
            canvas.height = Math.max(600, height);
            const ctx = canvas.getContext('2d');

            if (currentTheme === 1) ctx.fillStyle = '#ffffff';
            else if (currentTheme === 2) ctx.fillStyle = '#f1f5f9';
            else ctx.fillStyle = '#0f172a';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.save();
            ctx.translate(padding - minX, padding - minY);

            nodes.forEach(node => {
                if (node.children) {
                    node.children.forEach(child => {
                        const sx = node.x + node.width/2;
                        const sy = node.y;
                        const ex = child.x - child.width/2;
                        const ey = child.y;
                        const dx = ex - sx;
                        ctx.beginPath();
                        if (currentTheme === 2) {
                            const midX = sx + dx/2;
                            ctx.moveTo(sx, sy);
                            ctx.lineTo(midX, sy);
                            ctx.lineTo(midX, ey);
                            ctx.lineTo(ex, ey);
                            ctx.strokeStyle = '#64748b';
                            ctx.lineWidth = 1.5;
                            if (node.depth >= 1) ctx.setLineDash([4,4]); else ctx.setLineDash([]);
                        } else if (currentTheme === 3) {
                            ctx.strokeStyle = '#818cf8';
                            ctx.lineWidth = 2;
                            ctx.setLineDash([]);
                            ctx.moveTo(sx, sy);
                            ctx.bezierCurveTo(sx + dx/2, sy, ex - dx/2, ey, ex, ey);
                        } else {
                            ctx.strokeStyle = '#cbd5e0';
                            ctx.lineWidth = 2;
                            ctx.setLineDash([]);
                            ctx.moveTo(sx, sy);
                            ctx.bezierCurveTo(sx + dx/2, sy, ex - dx/2, ey, ex, ey);
                        }
                        ctx.stroke();
                    });
                }
            });

            nodes.forEach(node => {
                const x = node.x - node.width/2;
                const y = node.y - node.height/2;
                const w = node.width;
                const h = node.height;

                let bgColor, textColor;
                if (currentTheme === 1) {
                    if (node.depth === 0) { bgColor = '#667eea'; textColor = '#fff'; }
                    else if (node.depth === 1) { bgColor = '#f0f4ff'; textColor = '#667eea'; }
                    else { bgColor = '#f0fff4'; textColor = '#48bb78'; }
                } else if (currentTheme === 2) {
                    if (node.depth === 0) { bgColor = '#1e293b'; textColor = '#fff'; }
                    else if (node.depth === 1) { bgColor = '#f8fafc'; textColor = '#334155'; }
                    else { bgColor = '#ffffff'; textColor = '#475569'; }
                } else {
                    if (node.depth === 0) { bgColor = '#6366f1'; textColor = '#fff'; }
                    else if (node.depth === 1) { bgColor = '#334155'; textColor = '#e0e7ff'; }
                    else { bgColor = '#1e293b'; textColor = '#d1fae5'; }
                }

                ctx.fillStyle = bgColor;
                ctx.shadowColor = 'rgba(0,0,0,0.1)';
                ctx.shadowBlur = 8;
                ctx.shadowOffsetY = 2;

                const radius = currentTheme === 2 ? 4 : 12;
                ctx.beginPath();
                ctx.moveTo(x + radius, y);
                ctx.lineTo(x + w - radius, y);
                ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
                ctx.lineTo(x + w, y + h - radius);
                ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
                ctx.lineTo(x + radius, y + h);
                ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
                ctx.lineTo(x, y + radius);
                ctx.quadraticCurveTo(x, y, x + radius, y);
                ctx.closePath();
                ctx.fill();

                ctx.shadowColor = 'transparent';
                ctx.fillStyle = textColor;
                ctx.font = node.depth === 0 ? 'bold 22px "Microsoft YaHei", sans-serif' : (node.depth === 1 ? 'bold 16px "Microsoft YaHei"' : '500 14px "Microsoft YaHei"');
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const lines = node.data.name.split('\n');
                const lineHeight = 22;
                const startY = node.y - (lines.length - 1) * lineHeight / 2;
                lines.forEach((line, i) => {
                    ctx.fillText(line, node.x, startY + i * lineHeight);
                });
            });

            ctx.restore();
            const link = document.createElement('a');
            link.download = `导图_${new Date().toLocaleDateString()}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            showToast('图片已导出');
        }

        // ==================== 历史记录 ====================
        function saveToHistory() { if (!mindmapData) return; let history = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); const record = { id: Date.now(), title: mindmapData.name.substring(0,20) || '未命名', data: JSON.parse(JSON.stringify(mindmapData)), timestamp: new Date().toISOString(), nodeCount: countNodes(mindmapData) }; if (history.length >= 20) history.shift(); history.push(record); localStorage.setItem(STORAGE_KEY, JSON.stringify(history)); currentHistoryId = record.id; markSaved(); showToast('已保存到历史'); }
        function countNodes(node) { let n = 1; if (node.children) node.children.forEach(c => n += countNodes(c)); return n; }
        function toggleHistory() { document.getElementById('historyPanel').classList.toggle('active'); document.getElementById('panelOverlay').classList.toggle('active'); renderHistoryList(); }
        function renderHistoryList() { const history = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); document.getElementById('historyCount').textContent = history.length; const list = document.getElementById('historyList'); list.innerHTML = ''; if (!history.length) { list.innerHTML = '<div style="text-align:center; color:#999; padding:20px;">暂无记录</div>'; return; } [...history].reverse().forEach(h => { const d = new Date(h.timestamp); const item = document.createElement('div'); item.className = 'history-item'; item.innerHTML = `<div style="flex:1; padding:10px; background:#f1f5f9; border-radius:30px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;"><div><div style="font-weight:600;">${h.title}</div><div style="font-size:12px; color:#718096;">${d.toLocaleDateString()} · ${h.nodeCount}节点</div></div><button class="btn secondary" style="padding:10px 16px; min-height:auto;" onclick="event.stopPropagation(); loadHistory(${h.id})">恢复</button></div>`; list.appendChild(item); }); }
        function loadHistory(id) { let history = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); const h = history.find(x => x.id === id); if (!h) return; if (hasUnsavedChanges && !confirm('当前未保存，确定加载？')) return; mindmapData = JSON.parse(JSON.stringify(h.data)); renderMindmap(mindmapData); currentHistoryId = id; markSaved(); closeAllPanels(); showToast('已加载'); }
        function clearAllHistory() { if (confirm('清空所有历史记录？')) { localStorage.removeItem(STORAGE_KEY); currentHistoryId = null; renderHistoryList(); showToast('已清空'); } }

        // JSON导出
        function exportJSON() { if (!mindmapData) return; const blob = new Blob([JSON.stringify(mindmapData, null, 2)], {type:'application/json'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `导图_${new Date().toLocaleDateString()}.json`; a.click(); URL.revokeObjectURL(url); showToast('JSON已导出'); }

        // 缩放
        function zoomIn() { scale = Math.min(scale + 0.1, 2); document.getElementById('mindmap-canvas').style.transform = `scale(${scale})`; }
        function zoomOut() { scale = Math.max(scale - 0.1, 0.3); document.getElementById('mindmap-canvas').style.transform = `scale(${scale})`; }
        function resetZoom() { scale = 1; document.getElementById('mindmap-canvas').style.transform = `scale(1)`; }

        // 工具
        function markUnsaved() { hasUnsavedChanges = true; document.getElementById('unsavedWarning').style.display = 'block'; }
        function markSaved() { hasUnsavedChanges = false; document.getElementById('unsavedWarning').style.display = 'none'; }
        function showToast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2000); }
        function closeAllPanels() { document.querySelectorAll('.edit-panel, .text-parse-panel, .history-panel').forEach(p => p.classList.remove('active')); document.getElementById('panelOverlay').classList.remove('active'); }
        function loadExampleData() { mindmapData = { name: "法制支队示例", children: [ { name: "案件分析" }, { name: "证据梳理" } ] }; renderMindmap(mindmapData); markSaved(); }
        function handleFileImport(e) { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (ev) => { try { mindmapData = JSON.parse(ev.target.result); renderMindmap(mindmapData); currentHistoryId = null; showToast('导入成功'); } catch (err) { alert('JSON格式错误'); } }; reader.readAsText(file); }

        // 暴露全局
        window.switchTheme = switchTheme; window.toggleControls = toggleControls; window.openTextParser = openTextParser;
        window.loadParseExample = loadParseExample; window.clearParseText = clearParseText; window.parseAndGenerate = parseAndGenerate;
        window.importTxtFile = importTxtFile; window.saveToHistory = saveToHistory; window.toggleHistory = toggleHistory;
        window.exportImage = exportImage; window.exportJSON = exportJSON; window.addNode = addNode; window.addSiblingNode = addSiblingNode;
        window.deleteNode = deleteNode; window.saveNode = saveNode; window.closeAllPanels = closeAllPanels; window.loadExampleData = loadExampleData;
        window.handleFileImport = handleFileImport; window.zoomIn = zoomIn; window.zoomOut = zoomOut; window.resetZoom = resetZoom;
        window.clearAllHistory = clearAllHistory; window.loadHistory = loadHistory;
   