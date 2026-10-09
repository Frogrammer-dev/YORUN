# 품질 회귀 테스트용 지도 데이터

실제 OpenStreetMap 보행 길 데이터를 4.4km × 4.4km 영역으로 잘라 gzip으로 저장했다.
외부 서버(Overpass)가 바쁘거나 데이터가 바뀌어도 품질 테스트 결과가 흔들리지 않게 고정한다.

| 파일 | 영역 중심 | 데이터 기준 시각 |
|---|---|---|
| `gangnam-center.json.gz` | 37.506, 127.045 (서울 강남) | 2026-10-09T08:06:30Z |
| `gangnam-southwest.json.gz` | 37.490, 127.025 (서울 서초·강남) | 2026-10-09T08:06:30Z |

- 형식: Overpass `out body` 응답과 같은 `elements` 배열 + 잘라 낸 영역 `bbox`.
  영역에 걸친 길과 그 길의 모든 점을 담았다 (Overpass와 같은 규칙). 길 판단에 쓰는 태그만 남겼다.
- 출처·라이선스: © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/).
  https://www.openstreetmap.org/copyright
