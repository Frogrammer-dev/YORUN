# v12 독립 비판: 재사용 가능 범위와 실행 전 고정 사항

2026-11-02 실제 `sketch-head.py`, `sketch-features.py`, `diversityCatalog.ts`, `protocol-v12.md` 및 수집 metadata를 읽은 정적 감사다. 학습·추론·사람 인식 성능을 검증한 문서는 아니다.

**판단: head/prototype 계산부는 재사용 가능하나, 25종 완전 학습 지원은 이미 수집 기준 실패다.** 현재 자료는 2,304그림·32클래스(추천24+generic8), train/val/test=1,646/316/342다. 코드의 클래스 수·특징 차원은 동적이고, train-only 균형 ridge/prototype, val-only λ·margin 선택 후 test 평가 구조다. 사물/동물 모두 `object:true`여야 추천되며 동물이라는 이유로 generic 처리하면 안 된다.

| 생성 가설 | 학습 key/범위 | 고정해야 할 해석 |
|---|---|---|
| rocket | 공식 범주 없음, 미학습 | 대체 금지. 두 조건 모두 3요청 미지원 보류; 분모75 유지 |
| turtle | `sea_turtle` / 바다거북 | 일반 거북이 전반의 지원·정확도로 확대하지 않는다 |
| mug | `coffee_cup` / 커피잔 | 공식 `mug`·`cup`도 별개 범주다. 이번 자료·alias를 임의 교체하지 않는다 |

공식 [범주 목록](https://raw.githubusercontent.com/googlecreativelab/quickdraw-dataset/master/categories.txt)도 rocket 부재와 sea turtle/coffee cup/mug/cup의 구별을 확인한다. `text_baseline()`은 모든 학습 key가 text 사전에 있어야 하므로 rocket을 억지로 추가하면 CLI가 실패한다. 현재 지원32클래스도 key 대조는 실행 전에 해야 한다. 25종 평가 범위와 24종 학습 지원을 별도로 보고한다.

**누수·호환성.** v10 캐시 재사용은 허용되지만 같은 원본·회전·획순서 변형의 그룹 해시와 split을 유지하고, 기존 test를 새 독립 test라 부르지 않는다. 검증 분모를 확인하고 test/도로/3AI 결과로 λ·margin·alias를 조정하지 않는다. generic FAR≤0.1은 손그림 제외 범주 조건일 뿐 실제 도로의 미지 사물 거절률이 아니다. 특징 sidecar의 source/NPZ 해시와 encoder/revision/renderer/4뷰를 맞춰야 한다. `revision:null` 일치는 가중치 파일 동일성 증명이 아니다. 1,003행의 ID 순서·원본 필드 보존도 별도로 확인한다.

**75조건 selector는 기존 rank CLI의 기능이 아니다.** `rank_records()`는 전체 행을 분류하고 intent gate·geometry 중복 제거를 하지 않는다. 현재 `intentAgreement`에는 turtle→sea_turtle 연결도 없다. 따라서 외부 selector에서 고정 카탈로그 alias로 판정하고, 매 `(area, proposalShape)`의 같은 후보군에서 1개 또는 명시적 보류를 내야 한다. 전역 지역별 top2로 분모를6으로 줄이거나 쉬운 사물을 동물 요청 성공으로 옮기면 안 된다. 원본1,003행·기존 생성 counts는 보존한다. 요청 간 같은 geometry는 공유 사례로 기록하며 독립 성공으로 늘리지 않는다.

**대조·방향.** 사용자 초기 구상인 intent matching ON/OFF 중, 현재 실제 v12 프로토콜은 ON을 주평가, OFF 전역 선택을 진단 전용으로 명시한다. 두 조건의 후보군·보류·동률·표시 방향을 결과 전에 고정하고 유리한 조건으로 주평가를 바꾸지 않는다. `prediction.rotation`은 이미 `(90*viewIndex−배치각)%360`인 절대각이다. 원본 배치각을 다시 빼지 말고 별도 표시 metadata로 전달한다. 같은 픽셀 판정은 bridge로 재사용하고 새 독립 평가로 세지 않는다.

**반증·보고.** 기준선8/75와 primary0/75를 보존한다. 현 프로토콜의 ≥13/75, 동물3종·사물3종 각각2지역 이상, 도로 유효100%를 모두 요구하며 rocket 보류도 포함한다. 스케치 성능만 개선되거나, head가 prototype/생성기 첫 후보를 못 이기거나, 다른 사물 명명·한 형태 반복만 늘면 도로 식별 특징 개선 가설을 지지하지 않는다. v11은 요청당1개만 평가했으므로 전체 후보의 가능성 상한도 아니다. 모든 지역은 개발 자료이고 사람 인식은 미측정이다.

실행 주의: 기본 protocol/report/method 이름은 여전히 v10이다. CLI의 `--protocol`, `--report`, checkpoint/output 경로를 v12로 명시하고 구현 버전 태그와 실험 ID를 구분한다. 검토한 head SHA256: `ea41e791d25aa4f7e4ddae2de942e8b663ff52a9df3f08e097271c5b39854daa`. 문서는 계획 비판만 기록하며 코드·프로토콜·자료를 수정하지 않았다.
