# A: 공식 Strava 선집과 공개 Run 카드 10작품

## 1. 실제 실행과 시각 관찰을 확인했는가?

### Takeaway

2026-10-21에 7창작자의 10개 활동에서 Run 카드와 전체 경로 이미지 픽셀을 함께 확인했다. 단순 윤곽·짧은 실행도 포함했으며, 작품 이름을 먼저 알았으므로 블라인드 인식률 평가는 아니다.

### Cited Findings

수집 순서는 검색에서 찾은 공식 선집을 따라 2023 Best → Around the World → Road Runner 기사 → How Hard의 순서다. 각 페이지에서는 첫 적격 작품부터 확인했다. 2023 Best의 Ride·Kayaking·기존 사례·이미지 접근 불가 항목을 건너뛰었다. Around the World에서는 본문에 Run이라고 소개되더라도 공개 카드가 Hike인 뉴질랜드 작품을 제외했다. 마지막 기사는 그 안의 앞선 World 재게시, 자전거 작품, 제목만 연결된 작품을 본10에 다시 세지 않고, 실제 실행 카드가 있는 엄지척을 확인했다. [2023 Best](https://stories.strava.com/articles/the-best-strava-art-of-2023), [Around the World](https://stories.strava.com/articles/around-the-world-in-strava-art), [Road Runner](https://stories.strava.com/articles/spotted-on-strava-pogis-triple-crown-berlin-marathon-and-the-road-runner), [How Hard](https://stories.strava.com/articles/how-hard-is-it-to-make-strava-art).

| ID | 작품·창작자 | 표시 거리 | 직접 확인과 해석 | 실행 근거 |
|---|---|---:|---|---|
| A01 | 비둘기·올리브 / AndersPonny | 22.5 km | 두 날개·머리·꼬리와 올리브 가지, 분기. 산 배경의 톱니는 깃털인지 도로 잡음인지 불확실 | [Run 카드](https://strava-embeds.com/activity/8867144174) |
| A02 | Bigfoot / Lenny Maughan | 41.3 mi ≈66.47 km | 머리 내부 얼굴선, 양팔·벌어진 다리·큰 발, 도로 격자형 꺾임 | [Run 카드](https://strava-embeds.com/activity/9983912329) |
| A03 | Rabbit / Lenny Maughan | 44.3 mi ≈71.29 km | 귀 내부선·수염·몸통 내부 앞발, 중앙 지도 글씨가 얼굴 일부 가림 | [Run 카드](https://strava-embeds.com/activity/8650056537) |
| A04 | 미국 윤곽 / Gustavo Lyra | **6.8 km** | 윤곽 중심. 오대호의 작은 고리·교차 때문에 내부선·분기·엄격한 단일 폐윤곽 여부는 uncertain | [Run 카드](https://strava-embeds.com/activity/1070128185) |
| A05 | 브라질·예수상 / Gustavo Lyra | 27.2 km | 나라 외곽 안에 머리·두 팔·몸통·의복 선 | [Run 카드](https://strava-embeds.com/activity/1169121152) |
| A06 | 프랑스 윤곽 / Yann Cressent | 43.3 km | 내부 획은 없고 주 외곽 중심. 오른쪽 위 Y자 접근 획 때문에 엄격한 단일 폐윤곽으로 세지 않음 | [Run 카드](https://strava-embeds.com/activity/6644632131) |
| A07 | 영국 윤곽 / Nathan Rae | 63.4 km | 내부 획 없는 폐윤곽으로 보임. 본인이 도로·공원·수로에 맞춰 설계한 어려움을 서술 | [Run 카드·본인 설명](https://strava-embeds.com/activity/3053163808) |
| A08 | 세계 지도 / Peter GPS Artist | **169.6 km 총합·3회 실행** | 여러 대륙의 상대 위치와 대륙 안을 가로지르는 연결 획. 내부선이 반드시 의미 세부선인 것은 아님 | [Run 카드·본인 설명](https://strava-embeds.com/activity/12067605647) |
| A09 | Road Runner / Lenny Maughan | 8.9 mi ≈14.32 km | 눈·부리·머리·몸통·꼬리·다리와 트랙 고리. 공식 기사가 실제 트랙 반복을 설명 | [Run 카드](https://strava-embeds.com/activity/12387505517), [공식 설명](https://stories.strava.com/articles/spotted-on-strava-pogis-triple-crown-berlin-marathon-and-the-road-runner) |
| A10 | 엄지척 / Howard Calvert | **5.3 km** | 손바닥·엄지 외곽과 왼쪽 커프를 나누는 내부선 하나, T자 분기 | [Run 카드](https://strava-embeds.com/activity/12426173264), [본인 제작기](https://stories.strava.com/articles/how-hard-is-it-to-make-strava-art) |

### Inferences

전체 경로 이미지 주소는 `batch_a.json`에 보존했다. 카드의 img 요소에서 확인한 주소만 열었고, 검색 제목·ALT만 보고 특징을 판정하지 않았다. 정적 지도는 GPS 경로 시각 구조를 보여주지만 원 GPX의 순서·도로 그래프 연결성을 입증하지 않는다.

### Gaps

모든 실제 주행 표면, 작품별 재설계 횟수, 전체 왕복률, 일시정지 로그, 사람 인식률은 확보하지 못했다. 지도 글씨가 가린 작은 선은 불확실성을 기록했다.

## 2. 기존 결론과 같은 특성이 있는가, 반례는 무엇인가?

### Takeaway

내부 획이나 부분 관계를 가진 사례는 있지만 모든 작품의 공통 필수조건은 아니다. A04의 6.8 km 윤곽 중심 미국 작품(세부 교차 불확실), A07의 장거리 영국 단일 윤곽, A10의 5.3 km 내부선 있는 엄지척을 구분하면 거리와 표현 복잡도는 별도 축임이 드러난다.

### Cited Findings

- **구조 다양성:** Bigfoot·Rabbit·브라질 예수상·Road Runner는 주 외곽 안의 선과 구체적인 부분 배치가 보인다. 비둘기는 내부선 없이도 날개·몸·올리브 가지가 결합된다. [A01](https://strava-embeds.com/activity/8867144174), [A02](https://strava-embeds.com/activity/9983912329), [A03](https://strava-embeds.com/activity/8650056537), [A05](https://strava-embeds.com/activity/1169121152), [A09](https://strava-embeds.com/activity/12387505517).
- **윤곽 계열 반례:** 영국은 내부 획 없는 주 윤곽이며, 프랑스도 내부 획이 없되 접근 분기가 있다. 미국은 윤곽 중심이나 오대호 부근 미세 고리가 모호해 엄격한 단일 윤곽의 확정 반례로 쓰지 않는다. [A04](https://strava-embeds.com/activity/1070128185), [A06](https://strava-embeds.com/activity/6644632131), [A07](https://strava-embeds.com/activity/3053163808).
- **짧은 복합 예시:** 엄지척의 커프 구분선은 5.3 km에 들어간다. 장거리여야 내부 특징이 가능하다는 주장은 성립하지 않는다. [A10](https://strava-embeds.com/activity/12426173264).
- **일시정지 일반화 제동:** 세계 지도 창작자는 점을 잇는 stop/start 기법을 쓰지 않았다고 설명하지만, 동시에 세 아침·세 번의 달리기라고 밝힌다. 이 특정 기법의 부재와 모든 휴식/밤사이 정지 부재는 다르다. [A08](https://strava-embeds.com/activity/12067605647).
- **계획 근거의 범위:** Nathan의 활동 설명과 Howard의 제작기는 설계·장애물 대응을 직접 서술한다. 이를 다른 8작품 모두의 반복 설계 횟수로 확대할 수 없다. [Nathan](https://strava-embeds.com/activity/3053163808), [Howard](https://stories.strava.com/articles/how-hard-is-it-to-make-strava-art).

### Inferences

교차 의견 후 원 관찰자가 다시 확인한 최종 코딩: 내부 획 yes 6 / no 3 / uncertain 1; 분기·열린 획 yes 8 / no 1 / uncertain 1; 부분 배치 yes 7 / no 3; 작은 격자형 꺾임 yes 6 / no 3 / uncertain 1; 엄격한 단일 폐윤곽 yes 1 / no 8 / uncertain 1. B가 A04의 작은 고리와 A08의 대륙 내부 연결 선을 지적해 해당 필드를 정정했다. 이는 그림 픽셀의 관찰 빈도이며 인식에 필요한 정도나 인과 효과가 아니다.

분기 yes 8건에는 프랑스의 접근선처럼 의미 표현에 필요하다고 확인되지 않은 획도 있다. 시각적 분기와 의미 부위가 같은 뜻은 아니다. 실제 도로 그래프의 차수·주행 순서·반복·경로 토폴로지는 GPX 없이 증명하지 않았다.

거리 10/10을 확인했고 3~8 km는 2/10이다. 다만 A08은 3회 총합이므로 나머지 9개와 별도 표시해야 한다. 다른 9개가 모두 단일 연속 세션이라는 뜻은 아니다. 명시적 복수 세션 증거가 없는 것과 단일 세션 확인을 구분한다. A04/A05의 지도는 도로가 드문 지역으로 보이므로 현재 앱의 실제 도로만 사용 조건과 동등하다고 하지 않는다.

### Gaps

사람의 이름 없는 원본 인식 시험이 없으므로 각 부분이 없으면 인식률이 떨어지는지 알 수 없다. 고정 12조건의 기하학 점수 80점 목표와 이 표본 관찰은 다른 평가다.

## 3. 제외 로그와 표본 한계는 무엇인가?

### Takeaway

공식 기사의 소개만으로 Run 여부나 실제 도로 주행을 단정하지 않았다. 예술 선집은 대표성 있는 무작위 표본이 아니며 Strava·Lenny·국가 지도 군집 편향이 남는다.

### Cited Findings

| 확인했으나 본10에서 제외 | 사유·근거 |
|---|---|
| Frédéric·Mathilde 거대 하트 9807892788 | 자전거 기록 [2023 Best](https://stories.strava.com/articles/the-best-strava-art-of-2023) |
| Jeric London Dragon 8943283545 | 이전 6작품과 동일 활동 [카드](https://strava-embeds.com/activity/8943283545) |
| Nicolas London witch 10128169431 | Run 근거 확보 전 채택하지 않음 [2023 Best](https://stories.strava.com/articles/the-best-strava-art-of-2023) |
| Tim giraffe 10246633595 | 본문상 6개 Ride의 합성 [2023 Best](https://stories.strava.com/articles/the-best-strava-art-of-2023) |
| Jonathan heron 9456903096 | 공개 카드 Kayaking [카드](https://strava-embeds.com/activity/9456903096) |
| Weiss hummingbird 9789763543 | 기사에는 Run이나 공개 임베드 unavailable, 전체 픽셀 미확인 [카드](https://strava-embeds.com/activity/9789763543) |
| Anthony reindeer 10349340419 | 공개 카드 Ride [카드](https://strava-embeds.com/activity/10349340419) |
| John Australia 4681161462 | 공개 카드 Kayaking [카드](https://strava-embeds.com/activity/4681161462) |
| Peter NZ 11763678580 | 기사 Run 설명과 충돌: 현재 카드 Hike. 확정 Run 분모에서 제외 [카드](https://strava-embeds.com/activity/11763678580), [기사](https://stories.strava.com/articles/around-the-world-in-strava-art) |
| Harshan India 11771750905 | 공개 카드 Ride [카드](https://strava-embeds.com/activity/11771750905) |
| Adrien Belgium 11962182263 | 공개 카드 Ride [카드](https://strava-embeds.com/activity/11962182263) |
| Martijn Ukraine 9233150686 | 공개 임베드 unavailable [카드](https://strava-embeds.com/activity/9233150686) |
| World 12067605647의 How Hard 재게시 | A08과 같은 활동으로 중복 [How Hard](https://stories.strava.com/articles/how-hard-is-it-to-make-strava-art) |
| How Hard의 Nico Olympics/코이/Mark Cavendish | 본문은 자전거 제작 설명. Run 작품으로 세지 않음 [How Hard](https://stories.strava.com/articles/how-hard-is-it-to-make-strava-art) |
| BigBird Penrose 12437193412·Lenny echelon 12423678915 | 제목/표제만으로 본10에 추가하지 않았으며 예비 검증 가능 [How Hard](https://stories.strava.com/articles/how-hard-is-it-to-make-strava-art) |

### Inferences

동일 작가 2~3작품을 독립 창작자 표본처럼 해석하면 안 된다. 국가 지도는 제목이나 지리 지식의 도움을 많이 받을 수 있다. 예술 선집의 성공작 편향과 제작기 속 초보 사례를 함께 봐도 전체 사용자 작품의 비율은 추정할 수 없다.

### Gaps

선집에 실리지 않은 평범하거나 실패한 결과물의 분포, 원 GPX, 도로 사용률은 미확인이다. 예비 작품 2개는 `batch_a_reserve.json`에 별도 저장하며 자동으로 본30에 더하지 않는다. Howard의 실패에 가까운 얼굴 작품은 실제 Run과 픽셀을 확인했다. Peter의 Penrose는 Run이지만 점간 일시정지를 명시해 표시 0.1 km와 본인 진술 실제 21 km가 크게 다르다. 후자는 현재 앱의 연속 실제 도로 조건과 다른 보조 비교 사례이다. [실패 얼굴](https://strava-embeds.com/activity/12426875383), [Penrose](https://strava-embeds.com/activity/12437193412).
