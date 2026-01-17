import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// 從環境變數或配置中獲取 Supabase URL 和 Key
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || window.SUPABASE_URL || 'https://sjxzplehoelvzpbrtdhv.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqeHpwbGVob2VsdnpwYnJ0ZGh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2MzE5OTcsImV4cCI6MjA4NDIwNzk5N30.H_UuuUVvE3JAoc97k01u23RSp3phqMRLG3PAcycgjHU'

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('⚠️ Supabase URL 或 Anon Key 未配置')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// 認證狀態監聽
supabase.auth.onAuthStateChange((event, session) => {
  console.log('認證狀態變化:', event, session)
  if (event === 'SIGNED_IN') {
    updateUIForLoggedIn(session.user)
  } else if (event === 'SIGNED_OUT') {
    updateUIForLoggedOut()
  }
})

// 更新 UI 為已登入狀態
function updateUIForLoggedIn(user) {
  // 隱藏登入表單，顯示用戶信息
  const loginSection = document.getElementById('loginSection')
  const userSection = document.getElementById('userSection')
  const userEmail = document.getElementById('userEmail')
  
  if (loginSection) loginSection.style.display = 'none'
  if (userSection) userSection.style.display = 'block'
  if (userEmail) userEmail.textContent = user.email || '用戶'
}

// 更新 UI 為未登入狀態
function updateUIForLoggedOut() {
  // 顯示登入表單，隱藏用戶信息
  const loginSection = document.getElementById('loginSection')
  const userSection = document.getElementById('userSection')
  
  if (loginSection) loginSection.style.display = 'block'
  if (userSection) userSection.style.display = 'none'
}

// 登入功能
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })
  return { data, error }
}

// 註冊功能
export async function signUp(email, password, fullName = '') {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
      }
    }
  })
  return { data, error }
}

// 登出功能
export async function signOut() {
  const { error } = await supabase.auth.signOut()
  return { error }
}

// 獲取當前用戶
export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// 獲取當前會話
export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

// 檢查是否已登入
export async function isAuthenticated() {
  const user = await getCurrentUser()
  return !!user
}

// 初始化：檢查當前認證狀態
export async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession()
  if (session) {
    updateUIForLoggedIn(session.user)
  } else {
    updateUIForLoggedOut()
  }
}
