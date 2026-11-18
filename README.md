# 푸른시험

구글 설문지 대신 쓰는 시험 앱입니다. 전자 강의책(pureun-lecture)과 같은 방식(Firebase, 세로형 한 쪽 화면)으로 만들되, 저장소와 Firebase 프로젝트(`pureun-exam`)를 따로 씁니다.

- 학생: https://pureun-exam.web.app
- 교수: https://pureun-exam.web.app/?prof=1 (맨 처음 로그인한 구글 계정이 교수 계정으로 등록됩니다)

## 구조

| 파일 | 내용 |
|---|---|
| `public/index.html` | 화면 틀과 모양 |
| `public/app.js` | 시작점, 학생 화면(입장 · 안내 · 응시 · 결과 · 문제풀이) |
| `public/prof.js` | 교수 화면(명단 · 진행 · 문항 편집 · 서술형 채점 · 결과) |
| `public/core.js` | 채점 · 랜덤 · 문제지/정답지 분리 · 명단 · 부탁문 (화면과 무관한 계산) |
| `public/save.js` | 문항별 즉시 저장과 이어 풀기 |
| `public/fb.js` | Firebase 연결 |
| `database.rules.json` | 보안 규칙 |
| `tests/` | 자동 테스트 |

## 정답이 새지 않는 방법

문항은 세 곳에 나뉘어 저장됩니다. 학생 기기는 `sheets`(문제·보기·배점만)만 받고, 정답과 해설이 있는 `keys`는 교수가 "결과 공개"를 누르기 전에는 보안 규칙이 막습니다. 원본(`drafts`)은 교수만 읽습니다.

## 테스트와 배포

`main`에 올리면 GitHub Actions가 테스트를 모두 통과한 뒤에만 배포합니다. 데이터베이스 내용은 배포와 무관하므로 업데이트해도 시험·답안은 그대로 남습니다.

```
npm install
npm test            # 채점 · 랜덤 · 저장
npm run test:rules  # 보안 규칙 (자바 필요)
npm run test:e2e    # 브라우저에서 교수·학생 흐름 전체
```

## 안드로이드 앱

`android/` 는 시험 웹을 감싼 앱입니다. 웹이 할 수 없는 일(화면 고정, 캡처·녹화 차단, 방해 금지 자동 켜기/되돌리기, 이탈 알림)만 맡고, 화면과 기능은 웹을 그대로 씁니다. 그래서 웹을 고치면 앱을 다시 설치하지 않아도 반영됩니다.

- `android/` 가 바뀌면 GitHub Actions(`안드로이드 앱 만들기`)가 APK를 만들어 Releases 에 올립니다.
- 내려받기: https://github.com/lsc571-max/pureun-exam/releases/latest/download/pureun-exam.apk
- 서명 열쇠는 저장소에 없습니다. GitHub 비밀값 `ANDROID_KEYSTORE_BASE64` 에 넣어 두면 빌드마다 같은 열쇠로 서명해서 업데이트를 덮어 설치할 수 있습니다. 비밀값이 없으면 빌드마다 임시 열쇠를 쓰므로, 새 APK를 설치할 때 기존 앱을 지워야 합니다.
