# Whole-Q rollout 독립 구현 검토

구현과 평가 harness를 읽기 전용으로 검토했다. 이 문서는 실행 결과 또는 성능 향상 증거가 아니다. 구현을 수정하지 않았고 아직 source freeze 전 발견 사항을 담당자에게 전달했다.

## 실행 전 수정이 필요한 연결 문제

검토 당시 prefix candidate cap64에서 실제 `tested`는 proxy 상위2 + hash 상위2였다. Control beam은 proxy 상위12 + 나머지 hash 상위4이므로 tested 네 prefix 모두 Control에 이미 남는다. Treatment Q 상위2가 Control이 버린 **이미 평가된** prefix를 새로 살리는 경우는 이 연결에서 불가능하다.

Treatment의 selected identity가 달라질 수는 있다. Q elite를 넣으면서 proxy slot이 줄고 미평가 hash prefix가 더 들어가기 때문이다. 이것을 고Q 대안을 찾아 구출했다는 증거로 해석하면 안 된다. 함수 단위 synthetic contract는 실제 tested 전략으로 선택될 수 없는 proxy20/21에 점수를 부여해 이 연결 문제를 놓쳤다.

권고는 양 arm이 동일하게 proxy 상위2 + Control selected 밖의 hash 상위2를 rollout하는 것이다. Outside-control 후보가 없을 때의 fallback도 고정한다. 전체 actual tested→Q map→select 연결 contract에서 raw Q를 바꾸면 동일 evaluated prefix 중 어떤 것이 유지되는지 확인하고, native pilot에선 tested outside-control 수·평가 성공 수·Q feedback으로 구출된 scored prefix identity를 기록한다. 이것은 Q feedback의 실제 동작 검증이며 유사도 개선 증명은 아니다.

## 그 외 검토

- budget은 16unit 각각25000 transition 상한으로 공유되고 stage prefix1875×4 + suffix546×32 =24972 이내다. actual arc 내부 node 검사와 lower-bound setup은 별도 작업이므로 400000을 전체 연산 수로 부르지 않는다. 담당자가 lower-bound arc inspection 기록을 추가하고 있다.
- suffix와 prefix는 같은 실제 port graph arc의 전체 node를 연결한다. native 거리·return 거리/hop 하한, 반복/8000 중간 안전 bound를 사용한다. 최종 원식 거리·반복을 다시 검사한다.
- phase는 실제 arc 내부 node를 방문하며 전진하지만 동일 node의 여러 phase 전진을 허용한다. 기록만으로 실제 윤곽 coverage를 주장하지 않는다.
- harness는 원 도로 hash, 실제 path·template ROI, 실제 edges, canonical 후보, 원식 raw 재계산과 baseline 원래/canonical 고점 보존을 검사한다. 같은 edge geometry는 새 경로 개선으로 채택하지 않는다.
- 양 arm의 proposal 정책·profile·label4는 같고 Q feedback의 selection만 다르다. feedback으로 후속 상태가 갈라지므로 최종 후보 pool 자체가 같다는 주장은 하지 않는다. 실제 사용된 expansion/Q 호출도 서로 다를 수 있어 상한 동일과 호출 수 동일을 구분한다.
- 기존 latest-placement ordered48/48 유효 진단은 min3km 실패를 현재 병목으로 지지하지 않는다. 이번 실험은 품질 선택 가설이다. Resource label4나 exact port compression의 독립 효과는 이 두-arm 비교로 분리되지 않는다.

현재 검토에서 위 tested-selection 연결 이외 명백한 거리·연결 제약 위반은 발견하지 못했다. 실제 source frozen 계약과 native pilot 결과를 확인하기 전 실행 정확성·품질 개선을 확정하지 않는다.
