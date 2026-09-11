# 배포된 RebelAI + 데스크톱 작업자

## 구조

Vercel은 로그인·채팅 요청 접수와 화면을 담당합니다. 원격 Supabase의
claim_pending_chat_job은 로컬 공급자 요청을 제외합니다. 데스크톱의
claim_pending_local_chat_job은 지정한 사용자의 로컬 요청만 원자적으로 가져옵니다.
데스크톱에서 기존 RebelAI 백엔드를 실행하므로 카드·로어북·문맥 구성,
Realtime 스트리밍, 메시지 저장을 동일한 코드로 수행합니다.

이 첫 구현은 **신뢰하는 개인 데스크톱 한 대**를 위한 것입니다.
데스크톱에 Supabase service-role 등 백엔드 자격 증명이 필요하며,
소유자 필터가 이 자격 증명의 권한 자체를 제한하는 보안 샌드박스는 아닙니다.
다른 사람의 PC에 이 구성을 배포하면 안 됩니다. 일반 사용자용 기기 연결은
별도의 제한된 작업자 인증·권한 위임 설계가 필요합니다.

## 배포 순서

1. 로컬 DB 마이그레이션·타입·테스트를 검증합니다.
2. 운영 DB에 97, 98을 적용합니다. 98 적용 후 구버전 클라우드 작업자도
   로컬 요청을 가져가지 않습니다.
3. Vercel의 환경을 설정하고 새 코드를 배포합니다.
4. 데스크톱에 같은 코드와 백엔드 환경을 준비하고 빌드·작업자를 실행합니다.
5. API 키 화면에서 본인의 추론 서버 토큰을 등록하고 합성 캐릭터로 두 모델을 확인합니다.

## Vercel 환경

LOCAL_LLM_QUEUE_ENABLED=true
LOCAL_LLM_OWNER_ID=<본인의 Supabase Auth 사용자 UUID>
CHAT_RUNNER_TARGET=cloud (생략해도 cloud)

Vercel에는 LOCAL_LLM_BASE_URL과 추론 서버 토큰을 환경변수로 넣지 않습니다.
추론 토큰은 기존 API 키 등록/Vault 경로로 관리합니다.
해당 OWNER_ID만 로컬 키를 등록하고 로컬 요청을 보낼 수 있습니다.

## 데스크톱 환경과 실행

RebelAI 체크아웃의 .env.local에 기존 원격 Supabase 백엔드 설정을 안전하게
준비합니다. NEXT_PUBLIC_SUPABASE_URL, 공개 anon 키, SUPABASE_SERVICE_ROLE_KEY,
CHAT_ADMIN_SECRET 및 기존 보조 작업에 필요한 서버 설정이 해당됩니다.
웹에 노출하거나 대화에 붙여넣지 마세요.

추가 설정:

```dotenv
LOCAL_LLM_OWNER_ID=<Vercel과 같은 사용자 UUID>
LOCAL_LLM_BASE_URL=http://127.0.0.1:8000/v1
LOCAL_WORKER_PORT=3100
```

추론 서버는 별도로 켜둡니다. Node 24에서:

```sh
npm ci
npm run build
tmux new -s rebel-local-worker
npm run worker:local
```

worker:local은 Next 백엔드를 127.0.0.1:3100에만 바인딩하고,
CHAT_RUNNER_TARGET=local, LOCAL_LLM_ENABLED=true, LOCAL_LLM_QUEUE_ENABLED=true,
INTERNAL_API_ORIGIN=http://127.0.0.1:3100을 자식 프로세스에 지정합니다.
노트북 개발 서버는 필요하지 않습니다.

Ctrl+B, D로 분리합니다. tmux attach -t rebel-local-worker로 재접속합니다.
중단은 작업이 끝난 뒤 Ctrl+C를 사용하세요. 처리 중 강제 종료는 해당 요청을
중단시킬 수 있으며, 기존 stuck-job 정리 정책에 따라 오류 처리됩니다.
재부팅 후 자동 시작은 이 스크립트의 범위에 포함하지 않습니다.

작업자는 한 번에 한 요청을 처리합니다. 10초 간격 연결 신호가 45초 이상
없으면 새 로컬 채팅은 503 오프라인 오류를 반환합니다. 이 신호는 작업자
프로세스·DB 연결 상태이며 GPU 가용성까지 보증하지 않습니다.
접수 직후 작업자가 끊기는 경우도 있으므로 기존 대기/타임아웃 처리가 적용됩니다.
요청을 무조건 재실행하지 않아 중복 답변 생성을 피합니다.

## 검증

합성 카드로 local-rp-base와 local-rp-step500 각각 생성·스트리밍·저장을 확인합니다.
클라우드 작업자가 같은 큐를 확인해도 로컬 요청을 가져가지 않아야 합니다.
긴 입력은 추론 서버가 정확한 토큰 수로 거부하며 자동 축약하지 않습니다.
출력 상한은 2048토큰, 기본 provider 제한은 240초입니다.
실패 시 상용 모델로 자동 전환하지 않습니다. 별도 요약·임베딩 공급자는 기존 설정을 따릅니다.

운영 반영 후 npm run ops:smoke 및 실제 합성 대화를 확인하세요.
