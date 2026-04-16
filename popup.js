function formatDate(iso) {
  if (!iso) return '--';
  return new Date(iso).toLocaleString();
}

// 显示错误信息
function showError(message) {
  const errorDiv = document.getElementById('errorMessage');
  errorDiv.innerText = message;
  errorDiv.style.display = 'block';
  setTimeout(() => {
    errorDiv.style.display = 'none';
  }, 5000);
}

// 检查更新（从 GitHub 获取最新版本）
async function checkForUpdate() {
  const badge = document.getElementById('updateBadge');
  const msgDiv = document.getElementById('updateMessage');
  try {
    const response = await fetch('https://gist.githubusercontent.com/AGLLOO/fc3a62603672b96339aca919e32a4188/raw/version.json');
    if (!response.ok) throw new Error();
    const data = await response.json();
    const manifest = chrome.runtime.getManifest();
    const currentVersion = manifest.version;
    if (data.latestVersion && data.latestVersion !== currentVersion) {
      badge.style.display = 'inline-block';
      msgDiv.style.display = 'block';
      msgDiv.innerHTML = `✨ 新版本 ${data.latestVersion} 可用！<a href="${data.updateUrl}" target="_blank">点击下载更新</a><br>📝 ${data.releaseNotes || '请更新以获取最新功能和修复'}`;
    } else {
      badge.style.display = 'none';
      msgDiv.style.display = 'none';
    }
  } catch (err) {
    console.log('检查更新失败', err);
  }
}

async function loadStatus() {
  const response = await chrome.runtime.sendMessage({ action: 'getStatus' });
  const data = response.lastData || {};
  const id = response.submissionId;
  document.getElementById('currentId').innerText = id ? id.slice(0,8)+'...' : '未监控（请打开稿件页面）';
  
  if (!id) {
    // 未监控稿件，清空所有字段
    document.getElementById('state').innerText = '--';
    document.getElementById('workflowState').innerText = '--';
    document.getElementById('workflow').innerText = '--';
    document.getElementById('decisionDate').innerText = '--';
    document.getElementById('rxScreeningResult').innerText = '--';
    document.getElementById('lastStateChangeDate').innerText = '--';
    document.getElementById('modified').innerText = '--';
    document.getElementById('cycleNumber').innerText = '--';
    document.getElementById('historyList').innerHTML = '<div style="color: #6b7280;">未监控稿件，无法显示历史</div>';
    return;
  }
  
  document.getElementById('state').innerText = data.state || '--';
  document.getElementById('workflowState').innerText = data.workflowState || '--';
  document.getElementById('workflow').innerText = data.workflow || '--';
  document.getElementById('decisionDate').innerText = formatDate(data.decisionDate);
  document.getElementById('rxScreeningResult').innerText = data.rxScreeningResult || '--';
  document.getElementById('lastStateChangeDate').innerText = formatDate(data.lastStateChangeDate);
  document.getElementById('modified').innerText = formatDate(data.modified);
  document.getElementById('cycleNumber').innerText = data.cycleNumber ?? '--';
  
  const historyDiv = document.getElementById('historyList');
  const history = response.changeHistory || [];
  if (history.length === 0) {
    historyDiv.innerHTML = '<div style="color: #6b7280;">暂无变化记录</div>';
  } else {
    historyDiv.innerHTML = history.slice(0, 10).map(record => `
      <div class="history-item">
        <div class="time">${new Date(record.time).toLocaleString()}</div>
        <div>${record.changes.join('; ')}</div>
      </div>
    `).join('');
  }
}

function extractSubmissionId(url) {
  const match = url.match(/\/submissionBoard\/([a-f0-9-]+)\/finalReview/);
  return match ? match[1] : null;
}

async function detectCurrentSubmission() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return null;
  const id = extractSubmissionId(tab.url);
  if (id) {
    await chrome.runtime.sendMessage({ action: 'setSubmissionId', id: id });
    return id;
  } else {
    // 非稿件页面，清除监控
    await chrome.runtime.sendMessage({ action: 'setSubmissionId', id: null });
    return null;
  }
}

async function setManualId(id) {
  if (id === '') {
    await chrome.runtime.sendMessage({ action: 'setSubmissionId', id: null });
  } else if (id) {
    await chrome.runtime.sendMessage({ action: 'setSubmissionId', id: id });
  }
  await loadStatus();
}

async function manualRefresh() {
  const refreshBtn = document.getElementById('refreshBtn');
  refreshBtn.disabled = true;
  refreshBtn.innerText = '检查中...';
  try {
    const response = await chrome.runtime.sendMessage({ action: 'refresh' });
    if (response && response.success) {
      await loadStatus();
    } else {
      showError('刷新失败：' + (response?.error || '未知错误'));
    }
  } catch (err) {
    showError('刷新失败：' + err.message);
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.innerText = '🔄 立即检查';
  }
}

(async function() {
  await detectCurrentSubmission();
  await loadStatus();
  await checkForUpdate();
  
  document.getElementById('setIdBtn').addEventListener('click', () => {
    const manualId = document.getElementById('manualId').value.trim();
    setManualId(manualId);
  });
  
  document.getElementById('refreshBtn').addEventListener('click', manualRefresh);
})();