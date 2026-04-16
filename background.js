// 当前激活的稿件 ID
let currentSubmissionId = null;

// 当前稿件的数据（内存中）
let currentData = {
  lastData: {
    state: null,
    workflowState: null,
    workflow: null,
    decisionDate: null,
    rxScreeningResult: null,
    lastStateChangeDate: null,
    modified: null,
    cycleNumber: null
  },
  changeHistory: []
};

// 生成 API URL
function getApiUrl(submissionId) {
  return `https://submission.wiley.com/api/v2/tenants/1/submissions/${submissionId}/versions`;
}

// 提取关键字段
function extractFields(data) {
  const item = Array.isArray(data) ? data[0] : data;
  return {
    state: item?.state || null,
    workflowState: item?.workflowState || null,
    workflow: item?.workflow || null,
    decisionDate: item?.decisionDate || null,
    rxScreeningResult: item?.rxScreeningResult || null,
    lastStateChangeDate: item?.lastStateChangeDate || null,
    modified: item?.modified || null,
    cycleNumber: item?.cycleNumber ?? null
  };
}

// 比较变化
function checkChanges(newFields, oldFields) {
  const changes = [];
  for (const [key, val] of Object.entries(newFields)) {
    const oldVal = oldFields[key];
    if (oldVal !== undefined && oldVal !== val) {
      changes.push(`${key}: ${oldVal} → ${val}`);
    }
  }
  return changes;
}

// 保存当前稿件数据到 storage
async function saveCurrentData() {
  if (!currentSubmissionId) return;
  const allData = await chrome.storage.local.get('submissionsData');
  const submissionsData = allData.submissionsData || {};
  submissionsData[currentSubmissionId] = {
    lastData: currentData.lastData,
    changeHistory: currentData.changeHistory
  };
  await chrome.storage.local.set({ submissionsData });
}

// 加载指定稿件的数据
async function loadSubmissionData(submissionId) {
  const allData = await chrome.storage.local.get('submissionsData');
  const submissionsData = allData.submissionsData || {};
  const data = submissionsData[submissionId];
  if (data) {
    currentData = {
      lastData: data.lastData,
      changeHistory: data.changeHistory
    };
  } else {
    // 新稿件，初始化空数据
    currentData = {
      lastData: {
        state: null,
        workflowState: null,
        workflow: null,
        decisionDate: null,
        rxScreeningResult: null,
        lastStateChangeDate: null,
        modified: null,
        cycleNumber: null
      },
      changeHistory: []
    };
  }
}

// 更新状态（比较变化、记录历史、发送通知）
async function updateStatus(newData) {
  const newFields = extractFields(newData);
  const oldFields = currentData.lastData;
  const isFirstRun = oldFields.state === null;

  if (isFirstRun) {
    currentData.lastData = { ...newFields };
    await saveCurrentData();
    console.log(`[BG] 稿件 ${currentSubmissionId} 初始状态已保存`, currentData.lastData);
    return;
  }

  const changes = checkChanges(newFields, oldFields);
  if (changes.length > 0) {
    const record = {
      time: new Date().toISOString(),
      changes,
      newState: newFields.state,
      newWorkflowState: newFields.workflowState,
      newWorkflow: newFields.workflow,
      newDecisionDate: newFields.decisionDate,
      newRxScreeningResult: newFields.rxScreeningResult,
      newLastStateChangeDate: newFields.lastStateChangeDate,
      newModified: newFields.modified,
      newCycleNumber: newFields.cycleNumber
    };
    currentData.changeHistory.unshift(record);
    if (currentData.changeHistory.length > 50) currentData.changeHistory.pop();
    currentData.lastData = { ...newFields };
    await saveCurrentData();

    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon.png',
      title: `稿件 ${currentSubmissionId.slice(0,8)} 状态更新`,
      message: changes.join('\n'),
      priority: 2
    });
    console.log(`[BG] 检测到变化`, changes);
  } else {
    console.log(`[BG] 无变化`, newFields);
  }
}

// 主动获取 API 数据
async function fetchStatus() {
  if (!currentSubmissionId) {
    console.log('[BG] 未设置稿件 ID，跳过轮询');
    return;
  }
  try {
    const allCookies = await chrome.cookies.getAll({ url: 'https://submission.wiley.com' });
    const cookieString = allCookies.map(c => `${c.name}=${c.value}`).join('; ');
    const response = await fetch(getApiUrl(currentSubmissionId), {
      headers: {
        'Cookie': cookieString,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    console.log(`[BG] 获取到稿件 ${currentSubmissionId} 数据`, data);
    await updateStatus(data);
  } catch (error) {
    console.error('[BG] 请求失败', error);
  }
}

// 切换稿件 ID
async function setSubmissionId(id) {
  if (currentSubmissionId === id) return;
  // 保存当前稿件数据
  if (currentSubmissionId) {
    await saveCurrentData();
  }
  currentSubmissionId = id;
  await loadSubmissionData(id);
  console.log(`[BG] 切换到稿件 ${id}`);
  await chrome.storage.local.set({ currentSubmissionId: id });
  await fetchStatus(); // 立即获取新稿件状态
}

// 定时轮询（每 5 分钟）
chrome.alarms.create('fetchStatus', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'fetchStatus') {
    fetchStatus();
  }
});

// 消息监听（来自 popup）
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'setSubmissionId') {
    setSubmissionId(message.id).then(() => {
      sendResponse({ success: true });
    }).catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  } else if (message.action === 'getStatus') {
    chrome.storage.local.get(['currentSubmissionId']).then(async (result) => {
      const id = result.currentSubmissionId;
      if (id && id === currentSubmissionId) {
        sendResponse({
          submissionId: id,
          lastData: currentData.lastData,
          changeHistory: currentData.changeHistory
        });
      } else if (id) {
        await setSubmissionId(id);
        sendResponse({
          submissionId: id,
          lastData: currentData.lastData,
          changeHistory: currentData.changeHistory
        });
      } else {
        sendResponse({ submissionId: null, lastData: {}, changeHistory: [] });
      }
    }).catch(err => sendResponse({}));
    return true;
  }
});

// 扩展启动时恢复上次使用的稿件 ID
chrome.storage.local.get(['currentSubmissionId']).then(result => {
  if (result.currentSubmissionId) {
    setSubmissionId(result.currentSubmissionId);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[BG] 多稿件版扩展已安装');
});