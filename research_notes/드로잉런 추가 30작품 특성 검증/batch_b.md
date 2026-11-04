# 아시아의 실제 드로잉런 10작품 — B 배치

관찰일: 2026-10-21. `batch_b.json`은 최상위 10개 배열이다. 브라우저에서 실행 서술을 읽고 각 작품의 실제 경로 그림 전체 픽셀을 직접 확인했다. 원격 이미지는 다운로드·재배포하지 않았다. 같은 작가 군집: Yukio Yanagimoto 5개, Sweater 3개, Kitakubu 1개, 직장인 K씨 1개로 총4개 출처 창작자군이다. Kitakubu 코스 제작자는 본문에 게스트 やまさん으로 적혀 있다. 제목을 먼저 본 관찰이므로 사람 블라인드 인식 실험이 아니다.

## 추가 작품은 앞선 결론과 같은 특성을 보이는가?

### Takeaway

복합 작품의 내부 획·부분 관계는 반복되지만 모든 드로잉런의 필요조건은 아니다. 내부 획 없는 고구마 단일 윤곽과, 내부 얼굴선을 생략하고 귀·다리·꼬리·수염을 쓰는 고양이가 명확한 반례다.

### Cited Findings

|ID|작품·실제 거리|내부 획|분기/열린 획|부분 관계|작은 꺾임|단순폐윤곽|관찰 근거·원문|
|---|---|---|---|---|---|---|---|
|B01|자동차5km|yes|yes|yes|yes|no|차체 위 두 창문, 아래 두 바퀴. 원작자가 만들어 달렸다고 설명. [원문](https://sweater840.hatenablog.com/entry/2022/06/02/111917)|
|B02|알파카 약20km|yes|yes|yes|yes|no|귀·얼굴의 눈/코/입, 긴 목과 몸통·다리. [원문](https://sweater840.hatenablog.com/entry/2022/05/28/190536)|
|B03|매화·동박새42.3km|yes|yes|yes|yes|no|꽃잎 군집 옆에 눈·몸통·꼬리·발을 가진 새. 초록 공원 표시는 작품선에서 제외. [원문](https://note.com/yukioyanagimoto/n/nbfa7a0f324fc)|
|B04|코뿔소8.6km|yes|yes|yes|yes|no|뿔·귀·몸통·다리·꼬리 및 몸 안 구분선. 제목8km와 실제 카드8.6km를 구별. [원문](https://note.com/yukioyanagimoto/n/ne9d81011309b)|
|B05|오지 여우 약18km|uncertain|uncertain|yes|uncertain|uncertain|귀·주둥이·몸·왼쪽 큰 꼬리는 보임. 라벨 가림과 저대비 때문에 세부 선 확정 보류. [원문](https://note.com/kitakubu_tokyo/n/n77c29f986d3b)|
|B06|나팔꽃3.5km|yes|yes|yes|yes|no|꽃 안의 방사형 선, 줄기·잎. 실제 Strava 카드3.5km·21분. [원문](https://note.com/yukioyanagimoto/n/ncd3530242629)|
|B07|늘어나는 고양이5.22km|yes|yes|uncertain|yes|no|긴 윤곽과 안쪽에서 끝나는 선은 확인되나 얼굴·다리의 해석은 안정적이지 않음. [원문](https://note.com/yukioyanagimoto/n/nae75878097b6)|
|B08|아델리펭귄8.1km|yes|yes|yes|yes|no|머리 안 선·긴 몸통·두 발의 배치. 작가가 방향을 바꾸며 반복 설계했다고 설명. [원문](https://note.com/yukioyanagimoto/n/n2b57a5314a0c)|
|B09|여의도 고구마8.04km|no|no|no|no|yes|내부 획 없이 통통한 주변 고리. 본문약8km와 실제 카드8.04km를 구별. [원문](https://yunupa.tistory.com/entry/%EC%9B%90%EC%A0%95%EB%9F%B0-%EC%97%AC%EC%9D%98%EB%8F%84-%ED%95%9C%EB%B0%94%ED%80%B4-%EA%B3%A0%EA%B5%AC%EB%A7%88%F0%9F%8D%A0%EB%9F%B0-%ED%96%88%EB%8D%98-%EB%82%A0%F0%9F%8F%83%F0%9F%8F%BB?category=1232942)|
|B10|젠푸쿠지 고양이5.49km|no|yes|yes|yes|no|두 귀·네 수염·두 다리·꼬리. 실제 adidas RUNNING 카드5.49km. [원문](https://sweater840.hatenablog.com/entry/2021/11/26/234640)|

JSON에서 직접 집계: 내부 획 yes7/no2/uncertain1; 분기 yes8/no1/uncertain1; 부분 관계 yes8/no1/uncertain1; 작은 꺾임 yes8/no1/uncertain1; 단순폐윤곽 yes1/no8/uncertain1. 이는 목적 표집10개의 기술 통계이며 아시아 일반 러너의 비율이 아니다. 실제 픽셀 확인 방법과 전체 이미지URL은 JSON 각 항목에 기록했다.

### Inferences

- 복합 대상은 하나의 외곽과 낮은 곡률 오차만으로 충분히 설명하기 어렵다. 내부 획·가지·부분 관계를 표현할 수 있는 후보 생성도 검토할 근거가 있다.
- B09는 닮음이 단순한 고리에서도 생김을 보인다. 자동 경로를 전부 복합 구조로 바꾸기보다 단순 실루엣 탐색과 복합 획 탐색을 따로 지원할 수 있다.
- B07은 획과 이름이 있다고 높은 인식 품질이 보장되지 않는 사례다. 최종 원본의 이름 없는 평가가 필요하다.

### Gaps

원본 GPX를 분석하지 않아 실제 도로 연결·중복 거리 비율은 알 수 없다. 작은 꺾임이 도로 제약 탓인지 의도된 양식인지 인과적으로 확정하지 않는다. 이 표로 알고리즘 유사도80점 달성 여부를 말할 수 없다.

## 3~8km의 짧은 경로에서도 가능한가?

### Takeaway

정확한 공개 수치로3~8km에 들어가는 작품은4/10개다. 자동차5km와 나팔꽃3.5km는 내부 획을 쓰며, 고양이5.49km는 내부 얼굴선을 쓰지 않는다. 길이와 복잡도를 독립적으로 봐야 한다.

### Cited Findings

- 자동차는 특정 차종 실루엣을 재현하지 못했어도5km에서 차체·창문·바퀴를 만들었다. [B01](https://sweater840.hatenablog.com/entry/2022/06/02/111917)
- 나팔꽃의 실제 카드가3.5km를 표시한다. 긴 거리만이 내부 획을 만드는 조건은 아니다. [B06](https://note.com/yukioyanagimoto/n/ncd3530242629)
- 고양이5.49km의 작가는 하천길에서 꼬리를 찾고 나머지 실루엣을 도로에 맞춰 만들었다고 설명한다. 눈·입은 생략했고 수염4곳의 돌아오기·반복을 개별 서술한다. [B10](https://sweater840.hatenablog.com/entry/2021/11/26/234640)
- 펭귄과 코뿔소는 제목은8km지만 활동 카드가 각각8.1·8.6km이다. [B08](https://note.com/yukioyanagimoto/n/n2b57a5314a0c), [B04](https://note.com/yukioyanagimoto/n/ne9d81011309b)
- 고구마런의 활동 카드와 지도는8.04km이며, 작성자는 러닝한 후 이 코스의 이름을 알았다고 한다. 사전 도안형 창작과 우연한 닮음 발견을 구별할 사례다. [B09](https://yunupa.tistory.com/entry/%EC%9B%90%EC%A0%95%EB%9F%B0-%EC%97%AC%EC%9D%98%EB%8F%84-%ED%95%9C%EB%B0%94%ED%80%B4-%EA%B3%A0%EA%B5%AC%EB%A7%88%F0%9F%8D%A0%EB%9F%B0-%ED%96%88%EB%8D%98-%EB%82%A0%F0%9F%8F%83%F0%9F%8F%BB?category=1232942)

### Inferences

- 기존6개에서 눈에 띄던28~55km는 복잡·장거리 성공작 선택의 영향을 받았다. 이번 짧은 실행례 때문에 장거리 필수 주장은 수정해야 한다.
- 부분을 먼저 찾는 탐색은 B10의 실제 설명과 맞지만, 저예산 단일 윤곽 생성도 버릴 이유가 없다.
- 제약 완화 시 거리를 무조건 늘리기보다 특징 몇 개를 소량의 왕복으로 구현하는 효율도 독립 실험할 수 있다. B10의 왕복률은 미상이므로 현행20% 제한을 반드시 만족한다고 말할 수는 없다.

### Gaps

전체10개의 GPS 일시정지 여부는 모두 unknown이다. Kitakubu의 중간 휴식과 K씨의 쉬지 않은 달리기는 물리적 휴식에 관한 서술로, GPS 기록의 pause 사실과 동일시하지 않았다. 개별왕복이 명시된 것은 B10뿐이다. 나머지를 no로 세지 않는다.

## 어떤 자료를 찾았고 무엇을 제외했는가?

### Takeaway

한국 1인칭 실행 기록을 먼저 찾되 소개·홍보·계획을 제외하고 일본 개인 러닝 기록으로 확장했다. 추가10개를 채우기 위해 같은 한국 코스의 반복 실행을 다른 디자인으로 세지 않았다.

### Cited Findings

수집 순서와 적격 판단:

1. 한국/일본 일반 검색: 드로잉런 후기·거북이·GPS art run Japan·お絵かきラン5km. 한국 소개문과 앱 자동 생성 페이지는 실제 특정 Run 증거가 부족해 제외.
2. Sweater 블로그에서 자동차·알파카를 순서대로 채택(B01·B02). 원작자는 자기 작품을 만들고 달린 블로그라고 명시한다. [블로그](https://sweater840.hatenablog.com/)
3. Yukio 검색 결과의 매화·동박새·코뿔소를 채택(B03·B04). [작가](https://note.com/yukioyanagimoto)
4. 한국 실패 후기 확인. 도림천/보라매를 뛰던 익명 러너가 여의도에서 길을 잘못 들어 염창에서 되돌아와 중간에 끝냈다고 직접 설명한다. 실제 실행·왕복 증거는 있지만 원본 그림 호스트가 브라우저에서 차단돼 최종10에 포함하지 않음. [실패 후기](https://gall.dcinside.com/mgallery/board/view/?id=running&no=402039)
5. Kitakubu의 여우 실제 실행 보고 채택(B05). [실행 보고](https://note.com/kitakubu_tokyo/n/n77c29f986d3b)
6. Yukio 프로필의 작품 목록에서 짧은 나팔꽃·늘어나는 고양이·8km표기 펭귄을 순서대로 확인해 채택(B06~B08). 미완성 작품은 계획/실행 구분을 확인하지 않았으므로 본표에 넣지 않음. [작가 목록](https://note.com/yukioyanagimoto)
7. 한국 고구마런은 원정런 본인 후기·실제 카드·경로 이미지까지 확인한1건만 채택(B09). 다른 실행자나 반고구마 소개는 새 디자인 수로 부풀리지 않음. [B09](https://yunupa.tistory.com/entry/%EC%9B%90%EC%A0%95%EB%9F%B0-%EC%97%AC%EC%9D%98%EB%8F%84-%ED%95%9C%EB%B0%94%ED%80%B4-%EA%B3%A0%EA%B5%AC%EB%A7%88%F0%9F%8D%A0%EB%9F%B0-%ED%96%88%EB%8D%98-%EB%82%A0%F0%9F%8F%83%F0%9F%8F%BB?category=1232942)
8. Sweater 관련 글의 짧은 고양이 실루엣 확인 후 채택(B10). [B10](https://sweater840.hatenablog.com/entry/2021/11/26/234640)

주요 제외/보류:

- CityHeart·ShapeMiles 등의 생성/다운로드 코스: 특정 실제 Run 실행 증거가 없어 제외. [예](https://cityheart.run/blog/gps-art-tokyo/)
- GPSart.info의 다수 지역 코스: 공개 설계집만으로 실제 실행을 입증하지 못해 본10에 미채택. [예](https://gpsart.info/)
- Holiday Runner의 일반 십이지 코스집: 작가가 설계만 한 코스도 많다고 직접 적어 개별 실행 미확인 작품을 채택하지 않음. [원문](https://note.com/holiday_runner/n/n486cc59d1a12)
- 한국 티스토리 드로잉런 추천 모음: 특정 러너 실행·원본 활동 그림 대신 일반 소개여서 제외. [예](https://hiyaaa.tistory.com/194?category=1234445)

### Inferences

이 배치도 일본 개인 블로그·한 작가의 공개 작품에 군집되어 있다. 통계적 대표성을 갖추려면 후속에는 동일 작가 최대 수와 수집 기간을 정한 표본을 확보해야 한다. 원작자 제목을 본 평가와 사람의 이름 없는 식별률은 명확히 분리해야 한다.

### Gaps

한국의 다양한 드로잉 코스는 공개 원문 검색에서 소개·코스 공유·SNS 제한이 많아1개 디자인만 실행·픽셀까지 검증했다. 이를 한국 작품의 다양성 부족으로 해석할 수는 없다. web fetch가 일부 일본 페이지에서 실패했지만 브라우저의 공개 본문은 정상 열려 그 화면을 근거로 삼았다. 로그인이나 차단 우회는 하지 않았다.
