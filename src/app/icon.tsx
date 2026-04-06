// app/icon.tsx
import { ImageResponse } from 'next/og'

// 이 설정은 이미지가 엣지 런타임에서 생성되도록 합니다 (더 빠름)
export const runtime = 'edge'

// 이미지 크기 및 메타데이터 설정
export const size = {
  width: 32,
  height: 32,
}
export const contentType = 'image/png'

// 이미지 생성 함수
export default function Icon() {
  return new ImageResponse(
    // JSX로 그리는 아이콘 모습입니다. CSS와 유사합니다.
    <div
      style={{
        fontSize: 22, // 글자 크기
        background: '#1a1a1a', // 배경색 (어두운 색)
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#39FF14', // 글자색 (네온 그린)
        borderRadius: '20%', // 약간 둥근 네모
      }}
    >
      R{/* 'R' 대신 '🤖' 같은 이모지를 넣어도 됩니다! */}
    </div>,
    // ImageResponse 옵션
    {
      ...size,
    },
  )
}
