# v17 표현 대조: 최종 수치 감사와 반증

2026-11-03. source/cache/checkpoint/metadata·선택·평가 집계를 읽기 전용으로 검사했다. 이미지는 열거나 재판정하지 않았다. 학습·새 모델·표본·label·threshold 변경 없이 이 문서만 작성한다.

## 수행한 검산과 한계

`eval/recognition/model-env/Scripts/python.exe -B -c $audit` 인라인 Python 검사(exit0, tool chunk `7bcf22`)에서 v17-training-lock의 모든 파일 SHA, 같은 dataset2304개와 도로1003행, cache shape `2304×4×512` 및 `1003×4×512`를 확인했다. 원본 per-view L2와 mean4 합 정규화 계약은 기존 `load_features`로 재검증했다. NPZ에 ID가 없어 행 연결은 동결 JSON 순서와 source/NPZ 해시에 의존하며, 내장 ID로 독립 입증한 것은 아니다. 양쪽 training/road renderer·checkpoint·revision·4view 호환 계약도 검사했다. revision=null이라는 기존 한계는 남는다.

A의1003개 predictedClass/accepted/margin/pooledClassScores는 v12 결과와 정확히 같았다. A의75 reviewSlots·17개 선택 ID와 표시각은 v13 canonical 결과와 정확히 같았다. A/B의 ranking 원본 필드와 selected results1003행은 원래 source와 동등하며 좌표 변경이 없었다. 양쪽 표시가 view0·절대각 `(-generatorPlacement.rotDeg)%360`인지 확인했다. 실제4뷰와512차원을 유지하며 B는 view0, A는 mean4라는 표현 metadata와 체크포인트 계약을 확인했다. 앞선 사전 감사에서도 저장 weights로1003개 logits·margin·분류와 genuine4view scores를 검산했다.

저장 weights로 val/test logits만 계산했으며 weights를 다시 fit하지 않았다. A/B의 val logits에서 기존 gate 탐색을 다시 계산하여 저장 policy와 일치함을 확인했다. B의 선택 λ=.01은 저장된 val grid의 macro 최고·동률 큰λ 규칙과 일치한다. 코드와 입력 계약상 train-only fit/val-only 선택 경로이며 도로·사람 label 입력은 없다. 이는 숨은 실행 이력까지 증명하는 감사는 아니고, λ grid 자체를 재학습해 검증한 것도 아니다.

## 실제 결과

| 지표 | A 동결 mean4·canonical 표시 | B canonical0·canonical 표시 |
|---|---:|---:|
| 손그림 test macro |.8840737184|.8950855058|
| generic FAR |.0476190476|.0714285714|
| 추천/75 |17|32|
| 3AI target-clear/75 |7|7|
| 동물 target-clear/33 |1|1|
| 사물 target-clear/42 |6|6|
| primary target-clear |0|0|
| 보조 평가자2/3 target-clear |7 / 9|9 / 12|

손그림 지표는 저장 weights와 test342개에서 재계산했다. macro +1.1012%p지만 FAR +2.3810%p이므로 보조 안정성 기준은 실패다. generic FAR는 기존 손그림 경쟁 범주에 대한 값이며 실제도로 오수락률은 아니다.

도로 집계는 `diversity-v13-canonical-ai-results.json`과 `v17-canonical-ai-results.json`의 각 raw name/clarity를 frozen alias에 대조하고 이미지 token 일치·case ID/결측과 선택75슬롯의 연결을 확인해 검산했다. 이미지별3표로 target-clear를 먼저 계산했으며 위 수치와 저장 groups가 일치했다. primary 증가0·동물 증가0으로 주기준 실패, 다수결7/75는13 미달이며 동물3종/사물3종 각각2지역 gate도 실패다. 추천 증가15개를 인식 개선으로 세지 않는다.

사용자 보고의 신규12개 고유 이미지·기존20개 exact-pixel 판정 연결은 생성/bridge 운영 수치다. 이번 최종 검산은 그 분할을 새로 pixel 대조한 것이 아니며 외부 응답 생성 과정·평가자 실제 신원까지 인증하지 않았다. 같은 계열3AI·개발 지역·판정 재사용의 한계도 유지한다. 집계 파일의 일반 limitations 문구는 기존 생성기 첫 후보 평가처럼 서술된 부분이 있어 이 연구에서는 **모델 선택75슬롯**이라고 해석해야 한다. 이 문구 문제를 수치 오류로 보지는 않는다.

## 사례별 반증과 전체 결론을 분리

사람이 명확히 읽은 개발 dog-4는 A에서도 B에서도 chair/accepted다. margin .2515442→.0930949라는 변화만으로 올바른 인식이 된 것은 아니다. 따라서 **이번 설정에서 canonical view0 전환만으로 해당 오분류를 회복한다는 설명은 지지되지 않는다.** 모든 도로에서 orientation이 무관하거나 손그림의 얼굴/전신 차이가 원인이라고 단정할 근거도 없다. baseline dog-1의 인간 판정은 없으므로 인간 수준의 개선/퇴보 비교는 불가능하다.

전체75요청에서는 의미 성과 증가와 사전 기준 통과가 없었으므로 B를 채택하지 않는다. prototype의 보조 수치로 head의 실패를 대체하거나, 사람이 확인한 한 사례를 맞히도록 후속 threshold를 조정하지 않는다. 기존 사람 명확 사례는 그대로 보존하되 v17에서 새 사람 성과를 얻은 것은 아니다. 최종 목표와 독립 사람 일반화 검증은 미완료다.

## 다음 가설에 대한 한 단락 검토

**원본25종 템플릿의 canonical IMAGE embedding을 query로 하고, 각 요청의 같은 frozen pool에서 canonical 도로 embedding과 cosine으로1개를 고르는 조건부 검색**은 검토한 v7 TEXT345 winner gate나 v10/v12 손그림 train-class-mean prototype과 정확히 같은 방법은 아니다. 관련 스크립트·프로토콜에서 이 정확한 대조의 완료 기록은 찾지 못했지만 저장소 전체에서 전혀 시도되지 않았다고 단정하지 않는다. rocket 포함25종을 global class gate 없이 유지할 수 있고 사람/AI label fit은 필요 없다. 다만 v15에서 목표 외곽 자체의 의미 명확성이 충분히 확보되지 않았으므로 cosine 개선은 기하·스타일 일치일 수 있으며, QD 얼굴/전신 domain 차이 해결은 아직 가설이다. 또75개 강제 반환 대17/32개 gate 통과 비교에는 거절 제거·조건부 검색·query 표현의 효과가 섞인다. 따라서 같은 요청 pool·canonical renderer·후보/표시·75분모를 고정하고 기하 top1 및 가능하면 gate 없는 기존 손그림 prototype 조건부 검색과 구분해 비교해야 한다. 이름/참고를 숨긴 판정은 별도이며 query가 평가자에게 새면 안 된다. 새 encoder·label fit·사후 회전 선택 없이 사전 계획으로 시험할 수는 있지만, 이 문서는 구현·실행·학습 승인을 대신하는 결과 기록이 아니며 여기서는 아무것도 실행하지 않았다.
